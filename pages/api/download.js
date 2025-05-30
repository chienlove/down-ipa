import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);
const sessions = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let tempDir = null;
  let downloadedFile = null;

  try {
    const { appleId, password, appId, appVerId, twoFactorCode, sessionId } = req.body;

    if (!appleId || !password || !appId) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'Apple ID, mật khẩu và App ID là bắt buộc'
      });
    }

    const tempSessionId = sessionId || uuidv4();
    tempDir = path.join('/tmp', `ipa_${tempSessionId}`);
    const keychainPath = path.join(tempDir, 'ipatool.keychain');

    try {
      await fs.mkdir(tempDir, { recursive: true });
    } catch (err) {
      console.warn('Could not create temp directory:', err.message);
      tempDir = '/tmp';
    }

    const ipatoolPath = '/usr/local/bin/ipatool';

    if (!existsSync(ipatoolPath)) {
      return res.status(500).json({
        error: 'TOOL_NOT_FOUND',
        message: 'ipatool không tìm thấy'
      });
    }

    const env = {
      ...process.env,
      HOME: tempDir,
      TMPDIR: tempDir,
      KEYCHAIN_PATH: keychainPath
    };

    let existingSession = sessions.get(tempSessionId);

    // Nếu có session và client gửi mã 2FA
    if (existingSession && twoFactorCode) {
      console.log('Completing 2FA authentication...');

      try {
        const { stdout: authResult } = await execFileAsync(
          ipatoolPath,
          ['auth', '--keychain-passphrase', '', '--non-interactive', '--auth-code', twoFactorCode],
          {
            env,
            cwd: tempDir,
            timeout: 30000
          }
        );

        console.log('2FA completed:', authResult);
        sessions.delete(tempSessionId);
        existingSession = null;
      } catch (authError) {
        console.error('2FA error:', authError.message);
        return res.status(400).json({
          error: 'TWO_FACTOR_FAILED',
          message: 'Mã 2FA không đúng hoặc đã hết hạn'
        });
      }
    }

    // Nếu chưa có session => đăng nhập
    if (!existingSession) {
      console.log('Starting authentication...');

      try {
        const { stdout: authResult } = await execFileAsync(
          ipatoolPath,
          [
            'auth',
            'login',
            '--email', appleId,
            '--password', password,
            '--keychain-passphrase', '',
            '--non-interactive'
          ],
          {
            env,
            cwd: tempDir,
            timeout: 60000
          }
        );

        console.log('Authentication successful:', authResult);
      } catch (authError) {
        console.error('Auth error:', authError);

        if (
          authError.message.includes('verification code') ||
          authError.message.includes('two-factor') ||
          authError.stdout?.includes('verification code')
        ) {
          sessions.set(tempSessionId, {
            appleId,
            password,
            appId,
            appVerId,
            timestamp: Date.now()
          });

          return res.status(202).json({
            requiresTwoFactor: true,
            sessionId: tempSessionId,
            message: 'Cần nhập mã xác thực 2 yếu tố'
          });
        }

        return res.status(401).json({
          error: 'AUTH_FAILED',
          message: 'Đăng nhập thất bại. Vui lòng kiểm tra Apple ID và mật khẩu.'
        });
      }
    }

    // Đã xác thực → tiến hành tải IPA
    console.log(`Starting download for app: ${appId}`);

    const ipaFilename = `${appId}.ipa`;
    const ipaPath = path.join(tempDir, ipaFilename);

    const downloadArgs = [
      'download',
      '--bundle-identifier', appId,
      '--output', ipaPath
    ];

    if (appVerId) {
      downloadArgs.push('--app-version-id', appVerId);
    }

    const { stdout: downloadResult } = await execFileAsync(
      ipatoolPath,
      downloadArgs,
      {
        env,
        cwd: tempDir,
        timeout: 300000
      }
    );

    console.log('Download completed:', downloadResult);

    downloadedFile = ipaPath;
    const fileStats = await fs.stat(downloadedFile);
    const fileBuffer = await fs.readFile(downloadedFile);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${ipaFilename}"`);
    res.setHeader('Content-Length', fileStats.size);

    res.send(fileBuffer);

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      message: error.message || 'Tải xuống thất bại'
    });
  } finally {
    if (tempDir && tempDir !== '/tmp') {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Cleanup warning:', cleanupError.message);
      }
    }
  }
}

const oneHour = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.timestamp > oneHour) {
      sessions.delete(sessionId);
    }
  }
}, oneHour);
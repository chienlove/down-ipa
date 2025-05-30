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
      TMPDIR: tempDir
    };

    let existingSession = sessions.get(tempSessionId);

    // Nếu có session và client gửi mã 2FA
    if (existingSession && twoFactorCode) {
      console.log('Completing 2FA authentication...');

      try {
        const { stdout: authResult } = await execFileAsync(
          ipatoolPath,
          [
            'auth', 
            '--keychain', keychainPath,
            '--keychain-passphrase', '', 
            '--non-interactive', 
            '--auth-code', twoFactorCode
          ],
          {
            env,
            cwd: tempDir,
            timeout: 60000
          }
        );

        console.log('2FA completed:', authResult);
        
        // ✅ QUAN TRỌNG: Không xóa session sau 2FA, mà đánh dấu đã xác thực
        existingSession.authenticated = true;
        sessions.set(tempSessionId, existingSession);
        
      } catch (authError) {
        console.error('2FA error:', authError.message);
        return res.status(400).json({
          error: 'TWO_FACTOR_FAILED',
          message: 'Mã 2FA không đúng hoặc đã hết hạn'
        });
      }
    }

    // Nếu chưa có session hoặc chưa xác thực => đăng nhập
    if (!existingSession || !existingSession.authenticated) {
      console.log('Starting authentication...');

      try {
        const { stdout: authResult } = await execFileAsync(
          ipatoolPath,
          [
            'auth',
            'login',
            '--email', appleId,
            '--password', password,
            '--keychain', keychainPath,  // ✅ Thêm keychain path
            '--keychain-passphrase', '',
            '--non-interactive'
          ],
          {
            env,
            cwd: tempDir,
            timeout: 90000  // ✅ Tăng timeout
          }
        );

        console.log('Authentication successful:', authResult);
        
        // ✅ Đánh dấu đã xác thực thành công
        if (existingSession) {
          existingSession.authenticated = true;
        }
        
      } catch (authError) {
        console.error('Auth error:', authError);

        if (
          authError.message.includes('verification code') ||
          authError.message.includes('two-factor') ||
          authError.message.includes('두 단계') ||
          authError.stdout?.includes('verification code') ||
          authError.stderr?.includes('verification code')
        ) {
          // ✅ Lưu session với keychain path
          sessions.set(tempSessionId, {
            appleId,
            password,
            appId,
            appVerId,
            keychainPath,  // ✅ Lưu keychain path
            timestamp: Date.now(),
            authenticated: false
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

    // ✅ Kiểm tra xác thực trước khi download
    const currentSession = sessions.get(tempSessionId);
    if (currentSession && !currentSession.authenticated) {
      return res.status(401).json({
        error: 'NOT_AUTHENTICATED',
        message: 'Chưa hoàn tất xác thực'
      });
    }

    // Đã xác thực → tiến hành tải IPA
    console.log(`Starting download for app: ${appId}`);

    const ipaFilename = `${appId}.ipa`;
    const ipaPath = path.join(tempDir, ipaFilename);

    const downloadArgs = [
      'download',
      '--bundle-identifier', appId,
      '--keychain', keychainPath,  // ✅ Thêm keychain path
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
        timeout: 600000  // ✅ Tăng timeout lên 10 phút
      }
    );

    console.log('Download completed:', downloadResult);

    downloadedFile = ipaPath;
    const fileStats = await fs.stat(downloadedFile);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${ipaFilename}"`);
    res.setHeader('Content-Length', fileStats.size);

    // ✅ Stream file thay vì load hết vào memory
    const fileStream = await fs.open(downloadedFile, 'r');
    const readStream = fileStream.createReadStream();
    
    readStream.on('end', async () => {
      await fileStream.close();
      // ✅ Xóa session sau khi download thành công
      sessions.delete(tempSessionId);
    });
    
    readStream.on('error', async (error) => {
      await fileStream.close();
      console.error('Stream error:', error);
    });

    readStream.pipe(res);

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      message: error.message || 'Tải xuống thất bại'
    });
  } finally {
    // ✅ Delay cleanup để đảm bảo file được stream xong
    if (tempDir && tempDir !== '/tmp') {
      setTimeout(async () => {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn('Cleanup warning:', cleanupError.message);
        }
      }, 5000); // Delay 5 giây
    }
  }
}

// ✅ Cleanup session mỗi 30 phút thay vì 1 giờ
const thirtyMinutes = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.timestamp > thirtyMinutes) {
      console.log(`Cleaning up expired session: ${sessionId}`);
      sessions.delete(sessionId);
    }
  }
}, thirtyMinutes);
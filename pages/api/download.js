import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);
const sessions = new Map();

async function setupKeychain(ipatoolPath, env, tempDir) {
  try {
    await execFileAsync(
      ipatoolPath,
      ['auth', 'create-keychain', '--keychain-passphrase', ''],
      { env, cwd: tempDir }
    );
  } catch (error) {
    console.error('Keychain setup error:', error);
    throw new Error('Không thể thiết lập keychain');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { appleId, password, appId, twoFactorCode, sessionId } = req.body;
  const tempSessionId = sessionId || uuidv4();
  const tempDir = path.join('/tmp', `ipa_${tempSessionId}`);
  const keychainPath = path.join(tempDir, 'ipatool.keychain');

  try {
    // Setup environment
    await fs.mkdir(tempDir, { recursive: true });
    await fs.chmod(tempDir, 0o700);

    const ipatoolPath = '/usr/local/bin/ipatool';
    if (!existsSync(ipatoolPath)) {
      return res.status(500).json({
        error: 'TOOL_NOT_FOUND',
        message: 'Công cụ ipatool không khả dụng'
      });
    }

    const env = {
      ...process.env,
      HOME: tempDir,
      TMPDIR: tempDir,
      KEYCHAIN_PATH: keychainPath,
      PATH: `/usr/local/bin:${process.env.PATH}`
    };

    // Initialize keychain
    await setupKeychain(ipatoolPath, env, tempDir);

    // Handle authentication
    const existingSession = sessions.get(tempSessionId);

    // 2FA required but code not provided
    if (existingSession && !twoFactorCode) {
      return res.status(202).json({
        requiresTwoFactor: true,
        sessionId: tempSessionId,
        message: 'Vui lòng nhập mã xác thực 2 yếu tố được gửi đến thiết bị của bạn'
      });
    }

    // Process 2FA
    if (existingSession && twoFactorCode) {
      try {
        await execFileAsync(
          ipatoolPath,
          [
            'auth', 'complete',
            '--email', appleId,
            '--keychain-passphrase', '',
            '--auth-code', twoFactorCode,
            '--non-interactive'
          ],
          { env, cwd: tempDir, timeout: 30000 }
        );
        sessions.delete(tempSessionId);
      } catch (error) {
        console.error('2FA Error:', error);
        return res.status(400).json({
          error: 'TWO_FACTOR_FAILED',
          message: 'Mã xác thực không đúng hoặc đã hết hạn'
        });
      }
    } 
    // Initial login
    else if (!existingSession) {
      try {
        const { stdout, stderr } = await execFileAsync(
          ipatoolPath,
          [
            'auth', 'login',
            '--email', appleId,
            '--password', password,
            '--keychain-passphrase', '',
            '--non-interactive'
          ],
          { env, cwd: tempDir, timeout: 60000 }
        );

        // Detect 2FA requirement
        const output = stdout + stderr;
        if (output.includes('verification code') || output.includes('two-factor')) {
          sessions.set(tempSessionId, { appleId, password, appId });
          return res.status(202).json({
            requiresTwoFactor: true,
            sessionId: tempSessionId,
            message: 'Vui lòng nhập mã xác thực 2 yếu tố'
          });
        }
      } catch (error) {
        console.error('Login Error:', error);
        
        if (error.message.includes('verification code') || error.stderr?.includes('verification code')) {
          sessions.set(tempSessionId, { appleId, password, appId });
          return res.status(202).json({
            requiresTwoFactor: true,
            sessionId: tempSessionId,
            message: 'Vui lòng nhập mã xác thực 2 yếu tố'
          });
        }

        return res.status(401).json({
          error: 'AUTH_FAILED',
          message: 'Đăng nhập thất bại. Vui lòng kiểm tra Apple ID và mật khẩu'
        });
      }
    }

    // Download IPA after successful auth
    const ipaPath = path.join(tempDir, `${appId}.ipa`);
    const { stdout } = await execFileAsync(
      ipatoolPath,
      [
        'download',
        '--bundle-identifier', appId,
        '--output', ipaPath,
        '--keychain-passphrase', ''
      ],
      { env, cwd: tempDir, timeout: 300000 }
    );

    console.log('Download Success:', stdout);
    
    if (!existsSync(ipaPath)) {
      throw new Error('File IPA không được tạo');
    }

    const fileStats = await fs.stat(ipaPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    res.setHeader('Content-Length', fileStats.size);
    
    return fs.createReadStream(ipaPath).pipe(res);

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: error.message.includes('keyring') 
        ? 'Lỗi xác thực. Vui lòng thử lại từ đầu' 
        : error.message || 'Lỗi hệ thống'
    });
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Cleanup Error:', error);
    }
  }
}

// Cleanup sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.timestamp > 3600000) {
      sessions.delete(sessionId);
    }
  }
}, 3600000);
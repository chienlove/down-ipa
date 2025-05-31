import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync, createReadStream } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);
const sessions = new Map();

// Cleanup old sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.timestamp > 30 * 60 * 1000) { // 30 minutes
      sessions.delete(key);
      console.log(`Cleaned expired session: ${key}`);
    }
  }
}, 60000);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { appleId, password, appId, twoFactorCode, sessionId } = req.body;

  if (!appleId || !password || !appId) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'Vui lòng điền đầy đủ thông tin'
    });
  }

  const tempSessionId = sessionId || uuidv4();
  const tempDir = path.join('/tmp', `ipa_${tempSessionId}`);
  const keychainPath = path.join(tempDir, 'ipatool.keychain');

  await fs.mkdir(tempDir, { recursive: true });
  await fs.chmod(tempDir, 0o700);

  const ipatoolPath = '/usr/local/bin/ipatool';
  if (!existsSync(ipatoolPath)) {
    return res.status(500).json({
      error: 'TOOL_NOT_FOUND',
      message: 'Không tìm thấy công cụ ipatool'
    });
  }

  const env = {
    ...process.env,
    HOME: tempDir,
    TMPDIR: tempDir,
    KEYCHAIN_PATH: keychainPath
  };

  console.log('Starting login process for:', appleId);

  const args = [
    'auth', 'login',
    '--email', appleId,
    '--password', password,
    '--keychain-passphrase', ''
  ];
  
  if (twoFactorCode) {
    args.push('--auth-code', twoFactorCode);
  }

  try {
    // First try without 2FA code
    const { stdout } = await execFileAsync(ipatoolPath, args, {
      env,
      cwd: tempDir,
      timeout: 120000 // 2 minutes timeout
    });

    console.log('Login Success:', stdout);
    sessions.delete(tempSessionId);
  } catch (loginError) {
    const allErrorOutput = [
      loginError.stdout || '',
      loginError.stderr || '',
      loginError.message || ''
    ].join(' ').toLowerCase();

    console.log('Login Error Output:', allErrorOutput);

    const require2FAPatterns = [
      'verification code',
      'two-factor',
      'enter the verification code',
      'authentication code',
      'security code',
      'trusted device',
      'verify your identity',
      '2fa',
      'code required',
      '6-digit'
    ];

    const needs2FA = require2FAPatterns.some(p => allErrorOutput.includes(p));

    // If 2FA required but no code provided
    if (needs2FA && !twoFactorCode) {
      sessions.set(tempSessionId, {
        appleId, 
        password, 
        appId, 
        timestamp: Date.now(),
        attempts: 0
      });
      
      return res.status(200).json({
        requiresTwoFactor: true,
        sessionId: tempSessionId,
        message: 'Mã xác thực 2 yếu tố đã được gửi đến thiết bị của bạn. Vui lòng nhập mã 6 số'
      });
    }

    // If 2FA code provided but incorrect
    if (twoFactorCode && needs2FA) {
      const session = sessions.get(tempSessionId);
      if (session) {
        session.attempts = (session.attempts || 0) + 1;
        
        if (session.attempts >= 3) {
          sessions.delete(tempSessionId);
          return res.status(400).json({
            error: 'TOO_MANY_ATTEMPTS',
            message: 'Bạn đã nhập sai mã quá 3 lần. Vui lòng thử lại sau 30 phút'
          });
        }
      }

      return res.status(400).json({
        error: 'TWO_FACTOR_FAILED',
        message: 'Mã xác thực không đúng. Vui lòng kiểm tra và nhập lại'
      });
    }

    // Other authentication errors
    let errorMessage = 'Đăng nhập thất bại';
    if (allErrorOutput.includes('invalid credentials') || allErrorOutput.includes('incorrect password')) {
      errorMessage = 'Sai Apple ID hoặc mật khẩu';
    } else if (allErrorOutput.includes('account locked')) {
      errorMessage = 'Tài khoản bị khóa tạm thời do nhập sai nhiều lần';
    } else if (allErrorOutput.includes('network error')) {
      errorMessage = 'Lỗi kết nối với Apple. Vui lòng thử lại sau';
    }

    return res.status(401).json({
      error: 'AUTH_FAILED',
      message: errorMessage
    });
  }

  // Continue with download if authentication succeeds
  console.log('Starting download for:', appId);
  const ipaPath = path.join(tempDir, `${appId}.ipa`);

  try {
    const { stdout } = await execFileAsync(ipatoolPath, [
      'download',
      '--bundle-identifier', appId,
      '--output', ipaPath,
      '--keychain-passphrase', ''
    ], {
      env,
      cwd: tempDir,
      timeout: 300000 // 5 minutes timeout for download
    });

    console.log('Download Success:', stdout);

    if (!existsSync(ipaPath)) {
      throw new Error('Không thể tạo file IPA');
    }

    const fileStats = await fs.stat(ipaPath);
    if (fileStats.size === 0) {
      throw new Error('File IPA bị lỗi (kích thước = 0)');
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    res.setHeader('Content-Length', fileStats.size);

    const stream = createReadStream(ipaPath);
    return stream.pipe(res);

  } catch (downloadError) {
    console.error('Download Failed:', downloadError);

    let errorMessage = 'Không thể tải xuống ứng dụng';
    const errorOutput = (downloadError.stdout || downloadError.stderr || '').toLowerCase();

    if (errorOutput.includes('not found')) {
      errorMessage = 'Không tìm thấy ứng dụng với Bundle ID này trên App Store';
    } else if (errorOutput.includes('not purchased')) {
      errorMessage = 'Tài khoản chưa mua ứng dụng này';
    }

    return res.status(400).json({
      error: 'DOWNLOAD_FAILED',
      message: errorMessage
    });
  } finally {
    setTimeout(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log('Cleaned up:', tempDir);
      } catch (e) {
        console.warn('Cleanup error:', e);
      }
    }, 5000);
  }
}
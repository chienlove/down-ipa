import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync, createReadStream } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);
const sessions = new Map();

// Session cleanup
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.timestamp > 30 * 60 * 1000) {
      sessions.delete(sessionId);
      console.log(`Cleaned expired session: ${sessionId}`);
    }
  }
}, 5 * 60 * 1000);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { appleId, password, appId, twoFactorCode, sessionId } = req.body;

  // Input validation
  if (!appleId || !password || !appId) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'Vui lòng điền đầy đủ Apple ID, mật khẩu và Bundle ID'
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

  console.log('Starting authentication for:', appleId);

  // Build auth command
  const authArgs = [
    'auth', 'login',
    '--email', appleId,
    '--password', password,
    '--keychain-passphrase', ''
  ];

  if (twoFactorCode) {
    authArgs.push('--auth-code', twoFactorCode);
  }

  try {
    // First authentication attempt
    const { stdout, stderr } = await execFileAsync(ipatoolPath, authArgs, {
      env,
      cwd: tempDir,
      timeout: 120000
    });

    console.log('Auth success:', stdout);
    sessions.delete(tempSessionId);

  } catch (authError) {
    const errorOutput = [
      authError.stdout || '',
      authError.stderr || '',
      authError.message || ''
    ].join(' ').toLowerCase();

    console.log('Auth error output:', errorOutput);

    // Check if 2FA is required
    const needs2FA = [
      'verification code',
      'two-factor',
      'authentication code',
      'security code',
      'trusted device',
      '2fa',
      '6-digit'
    ].some(pattern => errorOutput.includes(pattern));

    // Handle 2FA case
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
        message: 'Vui lòng nhập mã xác thực 2 yếu tố (6 số) đã gửi đến thiết bị của bạn'
      });
    }

    // Handle incorrect 2FA
    if (twoFactorCode && needs2FA) {
      const session = sessions.get(tempSessionId);
      if (session) {
        session.attempts += 1;
        
        if (session.attempts >= 3) {
          sessions.delete(tempSessionId);
          return res.status(403).json({
            error: 'TOO_MANY_ATTEMPTS',
            message: 'Bạn đã nhập sai mã 2FA quá 3 lần. Vui lòng thử lại sau 30 phút'
          });
        }
      }

      return res.status(401).json({
        error: 'INVALID_2FA_CODE',
        message: 'Mã xác thực không đúng. Vui lòng kiểm tra lại'
      });
    }

    // Handle other errors
    let errorMessage = 'Đăng nhập thất bại';
    if (errorOutput.includes('invalid credentials')) {
      errorMessage = 'Sai Apple ID hoặc mật khẩu';
    } else if (errorOutput.includes('account locked')) {
      errorMessage = 'Tài khoản bị khóa tạm thời';
    }

    return res.status(401).json({
      error: 'AUTH_FAILED',
      message: errorMessage
    });
  }

  // Proceed with download after successful auth
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
      timeout: 300000
    });

    console.log('Download success:', stdout);

    if (!existsSync(ipaPath)) {
      throw new Error('Không tạo được file IPA');
    }

    const stats = await fs.stat(ipaPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    res.setHeader('Content-Length', stats.size);

    return createReadStream(ipaPath).pipe(res);

  } catch (downloadError) {
    console.error('Download failed:', downloadError);
    
    let errorMessage = 'Tải ứng dụng thất bại';
    const errorOutput = (downloadError.stderr || '').toLowerCase();
    
    if (errorOutput.includes('not found')) {
      errorMessage = 'Không tìm thấy ứng dụng với Bundle ID này';
    } else if (errorOutput.includes('not purchased')) {
      errorMessage = 'Tài khoản chưa mua ứng dụng này';
    }

    return res.status(400).json({
      error: 'DOWNLOAD_FAILED',
      message: errorMessage
    });
  } finally {
    setTimeout(() => fs.rm(tempDir, { recursive: true, force: true }), 5000);
  }
}
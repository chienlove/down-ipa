import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';

const activeSessions = new Map();

// Cleanup expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.lastActive > 30 * 60 * 1000) { // 30 minutes expiration
      activeSessions.delete(sessionId);
      console.log(`Cleaned expired session: ${sessionId}`);
    }
  }
}, 5 * 60 * 1000);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { appleId, password, appId, twoFactorCode, sessionId } = req.body;

  // Validate required fields
  if (!appleId || !password || !appId) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'Vui lòng nhập đầy đủ Apple ID, mật khẩu và Bundle ID'
    });
  }

  // Validate 2FA code format if provided
  if (twoFactorCode && !/^\d{6}$/.test(twoFactorCode)) {
    return res.status(400).json({
      error: 'INVALID_2FA_CODE',
      message: 'Mã xác thực phải chính xác 6 chữ số'
    });
  }

  const currentSessionId = sessionId || uuidv4();
  const session = activeSessions.get(currentSessionId) || { 
    attempts: 0,
    lastActive: Date.now()
  };

  const tempDir = path.join('/tmp', `ipa_${currentSessionId}`);
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const args = [
      'auth', 'login',
      '--email', appleId,
      '--password', password,
      ...(twoFactorCode ? ['--auth-code', twoFactorCode] : []),
      '--keychain-passphrase', ''
    ];

    const ipatool = spawn('/usr/local/bin/ipatool', args, {
      env: {
        ...process.env,
        HOME: tempDir,
        TMPDIR: tempDir
      }
    });

    let output = '';
    let is2FARequested = false;

    const handleData = (data) => {
      const dataStr = data.toString();
      output += dataStr;
      
      if (!is2FARequested && /verification code|two-factor|2fa|security code|6-digit/i.test(dataStr)) {
        is2FARequested = true;
        ipatool.kill();
      }
    };

    ipatool.stdout.on('data', handleData);
    ipatool.stderr.on('data', handleData);

    const exitCode = await new Promise((resolve) => {
      ipatool.on('close', (code) => {
        resolve(code);
      });
    });

    if (is2FARequested && !twoFactorCode) {
      activeSessions.set(currentSessionId, {
        ...session,
        appleId,
        password,
        appId,
        lastActive: Date.now()
      });

      return res.status(200).json({
        requiresTwoFactor: true,
        sessionId: currentSessionId,
        message: 'Vui lòng nhập mã xác thực 2 yếu tố (6 số) từ thiết bị của bạn'
      });
    }

    if (exitCode !== 0) {
      throw new Error(output || 'Authentication failed');
    }

    // Proceed with download after successful auth
    const ipaPath = path.join(tempDir, `${appId}.ipa`);
    const downloadProcess = spawn('/usr/local/bin/ipatool', [
      'download',
      '--bundle-identifier', appId,
      '--output', ipaPath,
      '--keychain-passphrase', ''
    ], {
      cwd: tempDir
    });

    const downloadExitCode = await new Promise((resolve) => {
      downloadProcess.on('close', resolve);
    });

    if (downloadExitCode !== 0) {
      throw new Error('Download failed');
    }

    const stats = await fs.stat(ipaPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    res.setHeader('Content-Length', stats.size);
    
    return fs.createReadStream(ipaPath).pipe(res);

  } catch (error) {
    console.error('Error:', error.message);

    let statusCode = 500;
    let errorType = 'SERVER_ERROR';
    let errorMessage = 'Đã xảy ra lỗi hệ thống';

    if (error.message.includes('verification code') || error.message.includes('two-factor')) {
      statusCode = 200;
      errorType = 'NEED_2FA';
      errorMessage = 'Vui lòng nhập mã xác thực 2 yếu tố';
    } else if (error.message.includes('invalid credentials')) {
      statusCode = 401;
      errorType = 'AUTH_FAILED';
      errorMessage = 'Sai Apple ID hoặc mật khẩu';
    }

    return res.status(statusCode).json({
      error: errorType,
      message: errorMessage
    });
  } finally {
    setTimeout(() => fs.rm(tempDir, { recursive: true, force: true }), 5000);
  }
}
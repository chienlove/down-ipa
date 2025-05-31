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

  // Validate Bundle ID format
  if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z0-9.-]+/.test(appId)) {
    return res.status(400).json({
      error: 'INVALID_BUNDLE_ID',
      message: 'Bundle ID không hợp lệ (ví dụ: com.example.app)'
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
  
  try {
    await fs.mkdir(tempDir, { recursive: true });

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
        ipatool.kill('SIGTERM');
      }
    };

    ipatool.stdout.on('data', handleData);
    ipatool.stderr.on('data', handleData);

    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ipatool.kill('SIGKILL');
        reject(new Error('Authentication timeout'));
      }, 60000); // 60 second timeout

      ipatool.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });

      ipatool.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
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

    let downloadOutput = '';
    downloadProcess.stdout.on('data', (data) => {
      downloadOutput += data.toString();
    });
    downloadProcess.stderr.on('data', (data) => {
      downloadOutput += data.toString();
    });

    const downloadExitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        downloadProcess.kill('SIGKILL');
        reject(new Error('Download timeout'));
      }, 300000); // 5 minute timeout for download

      downloadProcess.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });

      downloadProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    if (downloadExitCode !== 0) {
      throw new Error(`Download failed: ${downloadOutput}`);
    }

    // Check if file exists and is valid
    try {
      const stats = await fs.stat(ipaPath);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }
    } catch (error) {
      throw new Error('Downloaded file not found or invalid');
    }

    // Read file and send as response
    const fileBuffer = await fs.readFile(ipaPath);
    
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    res.setHeader('Content-Length', fileBuffer.length);
    
    // Clean up session after successful download
    activeSessions.delete(currentSessionId);
    
    return res.send(fileBuffer);

  } catch (error) {
    console.error('Error:', error.message);

    let statusCode = 500;
    let errorType = 'SERVER_ERROR';
    let errorMessage = 'Đã xảy ra lỗi hệ thống';

    if (error.message.includes('verification code') || error.message.includes('two-factor')) {
      statusCode = 200;
      errorType = 'NEED_2FA';
      errorMessage = 'Vui lòng nhập mã xác thực 2 yếu tố';
    } else if (error.message.includes('invalid credentials') || error.message.includes('Authentication failed')) {
      statusCode = 401;
      errorType = 'AUTH_FAILED';
      errorMessage = 'Sai Apple ID hoặc mật khẩu';
    } else if (error.message.includes('timeout')) {
      statusCode = 408;
      errorType = 'TIMEOUT';
      errorMessage = 'Quá thời gian chờ, vui lòng thử lại';
    } else if (error.message.includes('not found')) {
      statusCode = 404;
      errorType = 'APP_NOT_FOUND';
      errorMessage = 'Không tìm thấy ứng dụng hoặc chưa mua ứng dụng này';
    }

    return res.status(statusCode).json({
      error: errorType,
      message: errorMessage
    });
  } finally {
    // Cleanup temp directory
    try {
      setTimeout(async () => {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError.message);
        }
      }, 5000);
    } catch (error) {
      console.error('Cleanup scheduling error:', error.message);
    }
  }
}
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';

const activeSessions = new Map();

// Cleanup sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.lastActive > 30 * 60 * 1000) {
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

  // Validate input
  if (!appleId || !password || !appId) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'Vui lòng nhập đầy đủ Apple ID, mật khẩu và Bundle ID'
    });
  }

  const currentSessionId = sessionId || uuidv4();
  const session = activeSessions.get(currentSessionId) || { 
    attempts: 0,
    lastActive: Date.now()
  };

  // Prepare temp directory
  const tempDir = path.join('/tmp', `ipa_${currentSessionId}`);
  await fs.mkdir(tempDir, { recursive: true });

  // Start ipatool process with real-time streaming
  const ipatool = spawn('/usr/local/bin/ipatool', [
    'auth', 'login',
    '--email', appleId,
    '--password', password,
    ...(twoFactorCode ? ['--auth-code', twoFactorCode] : []),
    '--keychain-passphrase', '',
    '--verbose'
  ], {
    env: {
      ...process.env,
      HOME: tempDir,
      TMPDIR: tempDir
    }
  });

  let output = '';
  let is2FARequested = false;

  // Handle real-time output
  const handleOutput = (data) => {
    const dataStr = data.toString();
    output += dataStr;
    
    // Immediate 2FA detection
    if (!is2FARequested && /verification code|two-factor|2fa|security code/i.test(dataStr)) {
      is2FARequested = true;
      activeSessions.set(currentSessionId, { 
        ...session, 
        appleId, 
        password, 
        appId,
        lastActive: Date.now()
      });
      
      ipatool.kill(); // Stop the process as we need 2FA
      
      return res.status(200).json({
        requiresTwoFactor: true,
        sessionId: currentSessionId,
        message: 'Vui lòng nhập mã xác thực 2 yếu tố (6 số) từ thiết bị Apple của bạn'
      });
    }
  };

  ipatool.stdout.on('data', handleOutput);
  ipatool.stderr.on('data', handleOutput);

  ipatool.on('close', async (code) => {
    if (is2FARequested) return; // Already handled
    
    if (code !== 0) {
      await handleAuthError(output, currentSessionId, res);
      return;
    }

    // Authentication success - proceed with download
    try {
      const ipaPath = path.join(tempDir, `${appId}.ipa`);
      const downloadProcess = spawn('/usr/local/bin/ipatool', [
        'download',
        '--bundle-identifier', appId,
        '--output', ipaPath
      ], {
        cwd: tempDir,
        timeout: 300000 // 5 minutes timeout
      });

      downloadProcess.on('close', async (dlCode) => {
        if (dlCode !== 0) {
          return res.status(500).json({
            error: 'DOWNLOAD_FAILED',
            message: 'Không thể tải ứng dụng'
          });
        }

        const stats = await fs.stat(ipaPath);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
        res.setHeader('Content-Length', stats.size);
        
        fs.createReadStream(ipaPath).pipe(res);
      });
    } catch (error) {
      console.error('Download error:', error);
      res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Lỗi hệ thống khi xử lý tải xuống'
      });
    }
  });
}

async function handleAuthError(output, sessionId, res) {
  const session = activeSessions.get(sessionId);
  let errorMessage = 'Đăng nhập thất bại';
  let statusCode = 401;

  if (/invalid credentials|incorrect password/i.test(output)) {
    errorMessage = 'Sai Apple ID hoặc mật khẩu';
  } else if (/account locked/i.test(output)) {
    errorMessage = 'Tài khoản bị khóa tạm thời';
    statusCode = 403;
  } else if (session?.attempts >= 2) {
    errorMessage = 'Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau 30 phút';
    statusCode = 429;
  }

  if (session) {
    session.attempts += 1;
    session.lastActive = Date.now();
  }

  res.status(statusCode).json({
    error: 'AUTH_FAILED',
    message: errorMessage
  });
}
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
  // Set JSON content type for all responses unless it's a file download
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { appleId, password, appId, twoFactorCode, sessionId } = req.body;

  console.log('=== REQUEST DEBUG ===');
  console.log('Request body keys:', Object.keys(req.body));
  console.log('Has appleId:', !!appleId);
  console.log('Has password:', !!password);
  console.log('Has appId:', !!appId);
  console.log('Has twoFactorCode:', !!twoFactorCode);
  console.log('Has sessionId:', !!sessionId);
  console.log('====================');

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
  let session = activeSessions.get(currentSessionId);
  let output = '';
  
  // Debug session info
  console.log('=== SESSION DEBUG ===');
  console.log('Session ID:', currentSessionId);
  console.log('Has existing session:', !!session);
  console.log('Requires 2FA:', !!twoFactorCode);
  console.log('Active sessions count:', activeSessions.size);
  if (session) {
    console.log('Session data:', { 
      hasAppleId: !!session.appleId, 
      hasPassword: !!session.password,
      hasAppId: !!session.appId,
      attempts: session.attempts 
    });
  }
  console.log('====================');

  // If this is a 2FA request, we need existing session data
  if (twoFactorCode && sessionId) {
    if (!session) {
      return res.status(400).json({
        error: 'SESSION_EXPIRED',
        message: 'Phiên làm việc đã hết hạn, vui lòng đăng nhập lại'
      });
    }
    // Use session data for 2FA request
    req.body.appleId = session.appleId;
    req.body.password = session.password;
    req.body.appId = session.appId;
  }
  
  if (!session) {
    session = { 
      attempts: 0,
      lastActive: Date.now()
    };
  }

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

    console.log('=== IPATOOL EXECUTION ===');
    console.log('Command args (passwords hidden):', args.map(arg => 
      args.indexOf(arg) === args.indexOf(password) ? '[PASSWORD]' : 
      args.indexOf(arg) === args.indexOf(twoFactorCode) ? '[2FA_CODE]' : arg
    ));
    console.log('Working directory:', tempDir);
    console.log('========================');

    const ipatool = spawn('/usr/local/bin/ipatool', args, {
      env: {
        ...process.env,
        HOME: tempDir,
        TMPDIR: tempDir
      }
    });

    let is2FARequested = false;

    const handleData = (data) => {
      const dataStr = data.toString();
      output += dataStr;
      console.log('ipatool output:', dataStr.trim());
      
      if (!is2FARequested && /verification code|two-factor|2fa|security code|6-digit/i.test(dataStr)) {
        console.log('2FA detected in output');
        is2FARequested = true;
        ipatool.kill('SIGTERM');
      }
    };

    ipatool.stdout.on('data', handleData);
    ipatool.stderr.on('data', handleData);

    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log('Authentication timeout, killing process');
        ipatool.kill('SIGKILL');
        reject(new Error('Authentication timeout'));
      }, 60000); // 60 second timeout

      ipatool.on('close', (code) => {
        clearTimeout(timeout);
        console.log('ipatool auth process closed with code:', code);
        resolve(code);
      });

      ipatool.on('error', (error) => {
        clearTimeout(timeout);
        console.error('ipatool auth process error:', error);
        reject(error);
      });
    });

    console.log('=== AUTH RESULT ===');
    console.log('Exit code:', exitCode);
    console.log('2FA requested:', is2FARequested);
    console.log('Has 2FA code:', !!twoFactorCode);
    console.log('Output length:', output.length);
    console.log('==================');

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
      const dataStr = data.toString();
      downloadOutput += dataStr;
      console.log('Download stdout:', dataStr.trim());
    });
    downloadProcess.stderr.on('data', (data) => {
      const dataStr = data.toString();
      downloadOutput += dataStr;
      console.log('Download stderr:', dataStr.trim());
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
    
    // Change content type for file download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    res.setHeader('Content-Length', fileBuffer.length);
    
    // Clean up session after successful download
    activeSessions.delete(currentSessionId);
    
    return res.send(fileBuffer);

  } catch (error) {
    console.error('=== ERROR DETAILS ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Session ID:', currentSessionId);
    console.error('Has 2FA code:', !!twoFactorCode);
    console.error('Output:', output);
    console.error('=====================');

    let statusCode = 500;
    let errorType = 'SERVER_ERROR';
    let errorMessage = 'Đã xảy ra lỗi hệ thống';

    // More detailed error checking
    const errorLower = (error.message || '').toLowerCase();
    const outputLower = (output || '').toLowerCase();
    
    if (errorLower.includes('verification code') || errorLower.includes('two-factor') || errorLower.includes('2fa') ||
        outputLower.includes('verification code') || outputLower.includes('two-factor') || outputLower.includes('2fa')) {
      
      // If we don't have a 2FA code but it's required, request it
      if (!twoFactorCode) {
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
      } else {
        // 2FA code was provided but failed
        statusCode = 401;
        errorType = 'AUTH_FAILED';
        errorMessage = 'Mã 2FA không đúng hoặc đã hết hạn';
      }
    } else if (errorLower.includes('invalid credentials') || errorLower.includes('authentication failed') || errorLower.includes('sign in failed')) {
      statusCode = 401;
      errorType = 'AUTH_FAILED';
      errorMessage = 'Sai Apple ID, mật khẩu hoặc mã 2FA';
    } else if (errorLower.includes('timeout')) {
      statusCode = 408;
      errorType = 'TIMEOUT';
      errorMessage = 'Quá thời gian chờ, vui lòng thử lại';
    } else if (errorLower.includes('not found') || errorLower.includes('app not available')) {
      statusCode = 404;
      errorType = 'APP_NOT_FOUND';
      errorMessage = 'Không tìm thấy ứng dụng hoặc chưa mua ứng dụng này';
    } else if (errorLower.includes('empty') || errorLower.includes('file not found')) {
      statusCode = 500;
      errorType = 'DOWNLOAD_FAILED';
      errorMessage = 'Tải xuống thất bại, vui lòng thử lại';
    }

    return res.status(statusCode).json({
      error: errorType,
      message: errorMessage,
      // Include debug info in development
      ...(process.env.NODE_ENV === 'development' && {
        debug: {
          originalError: error.message,
          sessionId: currentSessionId,
          hasSession: activeSessions.has(currentSessionId),
          output: output
        }
      })
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
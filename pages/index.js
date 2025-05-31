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
  console.log('=== API CALL START ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  // Set JSON content type for all responses unless it's a file download
  res.setHeader('Content-Type', 'application/json');
  
  try {
    if (req.method !== 'POST') {
      console.log('❌ Method not allowed:', req.method);
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    console.log('✅ Method is POST');
    console.log('Raw body:', req.body);

    const { appleId, password, appId, twoFactorCode, sessionId } = req.body;

    console.log('=== REQUEST PARSING ===');
    console.log('Request body keys:', Object.keys(req.body || {}));
    console.log('Has appleId:', !!appleId, '- Value length:', appleId?.length || 0);
    console.log('Has password:', !!password, '- Value length:', password?.length || 0);
    console.log('Has appId:', !!appId, '- Value length:', appId?.length || 0);
    console.log('Has twoFactorCode:', !!twoFactorCode, '- Value:', twoFactorCode);
    console.log('Has sessionId:', !!sessionId, '- Value:', sessionId);
    console.log('========================');

    // Validate required fields
    if (!appleId || !password || !appId) {
      console.log('❌ Missing required fields');
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'Vui lòng nhập đầy đủ Apple ID, mật khẩu và Bundle ID',
        debug: {
          hasAppleId: !!appleId,
          hasPassword: !!password,
          hasAppId: !!appId
        }
      });
    }

    console.log('✅ All required fields present');

    // Validate Bundle ID format
    const bundleIdRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z0-9.-]+/;
    if (!bundleIdRegex.test(appId)) {
      console.log('❌ Invalid Bundle ID format:', appId);
      return res.status(400).json({
        error: 'INVALID_BUNDLE_ID',
        message: 'Bundle ID không hợp lệ (ví dụ: com.example.app)',
        debug: { appId, regex: bundleIdRegex.toString() }
      });
    }

    console.log('✅ Bundle ID format valid');

    // Validate 2FA code format if provided
    if (twoFactorCode && !/^\d{6}$/.test(twoFactorCode)) {
      console.log('❌ Invalid 2FA code format:', twoFactorCode);
      return res.status(400).json({
        error: 'INVALID_2FA_CODE',
        message: 'Mã xác thực phải chính xác 6 chữ số'
      });
    }

    if (twoFactorCode) {
      console.log('✅ 2FA code format valid');
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
        console.log('❌ Session expired for 2FA request');
        return res.status(400).json({
          error: 'SESSION_EXPIRED',
          message: 'Phiên làm việc đã hết hạn, vui lòng đăng nhập lại'
        });
      }
      // Use session data for 2FA request
      req.body.appleId = session.appleId;
      req.body.password = session.password;
      req.body.appId = session.appId;
      console.log('✅ Using session data for 2FA request');
    }
    
    if (!session) {
      session = { 
        attempts: 0,
        lastActive: Date.now()
      };
      console.log('✅ Created new session');
    }

    const tempDir = path.join('/tmp', `ipa_${currentSessionId}`);
    console.log('Temp directory:', tempDir);
    
    // Check if ipatool exists
    try {
      const { spawn: testSpawn } = await import('child_process');
      const testProcess = testSpawn('which', ['ipatool']);
      const ipatoolPath = await new Promise((resolve, reject) => {
        let output = '';
        testProcess.stdout.on('data', (data) => {
          output += data.toString();
        });
        testProcess.on('close', (code) => {
          if (code === 0) {
            resolve(output.trim());
          } else {
            reject(new Error('ipatool not found'));
          }
        });
        testProcess.on('error', reject);
      });
      console.log('✅ ipatool found at:', ipatoolPath);
    } catch (error) {
      console.log('❌ ipatool check failed:', error.message);
      return res.status(500).json({
        error: 'IPATOOL_NOT_FOUND',
        message: 'Công cụ tải xuống chưa được cài đặt trên server',
        debug: { error: error.message }
      });
    }

    try {
      console.log('Creating temp directory...');
      await fs.mkdir(tempDir, { recursive: true });
      console.log('✅ Temp directory created successfully');

      // Test directory permissions
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
      console.log('✅ Directory permissions OK');

      const args = [
        'auth', 'login',
        '--email', appleId,
        '--password', password,
        ...(twoFactorCode ? ['--auth-code', twoFactorCode] : []),
        '--non-interactive'
      ];

      console.log('=== IPATOOL EXECUTION ===');
      console.log('Command args (passwords hidden):', args.map((arg, index) => 
        arg === password ? '[PASSWORD]' : 
        arg === twoFactorCode ? '[2FA_CODE]' : arg
      ));
      console.log('Working directory:', tempDir);
      console.log('Process environment keys:', Object.keys(process.env).slice(0, 10));
      console.log('========================');

      const ipatoolCommand = '/usr/local/bin/ipatool';
      console.log('Spawning process:', ipatoolCommand, 'with args count:', args.length);

      const ipatool = spawn(ipatoolCommand, args, {
        env: {
          ...process.env,
          HOME: tempDir,
          TMPDIR: tempDir,
          XDG_CONFIG_HOME: tempDir,
          XDG_DATA_HOME: tempDir
        },
        cwd: tempDir
      });

      console.log('✅ Process spawned, PID:', ipatool.pid);

      let is2FARequested = false;
      let processFinished = false;

      const handleData = (data, source) => {
        const dataStr = data.toString();
        output += dataStr;
        console.log(`ipatool ${source}:`, dataStr.trim());
        
        if (!is2FARequested && /verification code|two-factor|2fa|security code|6-digit/i.test(dataStr)) {
          console.log('🔐 2FA detected in output');
          is2FARequested = true;
          if (!processFinished) {
            console.log('Killing process due to 2FA request');
            ipatool.kill('SIGTERM');
          }
        }
      };

      ipatool.stdout.on('data', (data) => handleData(data, 'stdout'));
      ipatool.stderr.on('data', (data) => handleData(data, 'stderr'));

      ipatool.on('spawn', () => {
        console.log('✅ Process spawned successfully');
      });

      ipatool.on('error', (error) => {
        console.error('❌ Process spawn error:', error);
      });

      const exitCode = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.log('⏰ Authentication timeout, killing process');
          if (!processFinished) {
            ipatool.kill('SIGKILL');
            reject(new Error('Authentication timeout'));
          }
        }, 60000); // 60 second timeout

        ipatool.on('close', (code, signal) => {
          processFinished = true;
          clearTimeout(timeout);
          console.log('Process closed - Code:', code, 'Signal:', signal);
          resolve(code);
        });

        ipatool.on('exit', (code, signal) => {
          processFinished = true;
          clearTimeout(timeout);
          console.log('Process exited - Code:', code, 'Signal:', signal);
          resolve(code);
        });

        ipatool.on('error', (error) => {
          processFinished = true;
          clearTimeout(timeout);
          console.error('Process error:', error);
          reject(error);
        });
      });

      console.log('=== AUTH RESULT ===');
      console.log('Exit code:', exitCode);
      console.log('2FA requested:', is2FARequested);
      console.log('Has 2FA code:', !!twoFactorCode);
      console.log('Output length:', output.length);
      console.log('Full output:', output);
      console.log('==================');

      if (is2FARequested && !twoFactorCode) {
        activeSessions.set(currentSessionId, {
          ...session,
          appleId,
          password,
          appId,
          lastActive: Date.now()
        });

        console.log('✅ Returning 2FA request');
        return res.status(200).json({
          requiresTwoFactor: true,
          sessionId: currentSessionId,
          message: 'Vui lòng nhập mã xác thực 2 yếu tố (6 số) từ thiết bị của bạn'
        });
      }

      if (exitCode !== 0) {
        console.log('❌ Authentication failed with exit code:', exitCode);
        throw new Error(output || 'Authentication failed');
      }

      console.log('✅ Authentication successful, proceeding with download...');

      // Proceed with download after successful auth
      const ipaPath = path.join(tempDir, `${appId}.ipa`);
      console.log('IPA download path:', ipaPath);
      
      const downloadArgs = [
        'download',
        '--bundle-identifier', appId,
        '--output', ipaPath,
        '--non-interactive'
      ];

      console.log('Download command args:', downloadArgs);

      const downloadProcess = spawn('/usr/local/bin/ipatool', downloadArgs, {
        cwd: tempDir,
        env: {
          ...process.env,
          HOME: tempDir,
          TMPDIR: tempDir,
          XDG_CONFIG_HOME: tempDir,
          XDG_DATA_HOME: tempDir
        }
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
          console.log('Download timeout, killing process');
          downloadProcess.kill('SIGKILL');
          reject(new Error('Download timeout'));
        }, 300000); // 5 minute timeout for download

        downloadProcess.on('close', (code) => {
          clearTimeout(timeout);
          console.log('Download process closed with code:', code);
          resolve(code);
        });

        downloadProcess.on('error', (error) => {
          clearTimeout(timeout);
          console.error('Download process error:', error);
          reject(error);
        });
      });

      console.log('Download exit code:', downloadExitCode);
      console.log('Download output:', downloadOutput);

      if (downloadExitCode !== 0) {
        throw new Error(`Download failed: ${downloadOutput}`);
      }

      // Check if file exists and is valid
      try {
        const stats = await fs.stat(ipaPath);
        console.log('File stats:', { size: stats.size, exists: true });
        if (stats.size === 0) {
          throw new Error('Downloaded file is empty');
        }
      } catch (error) {
        console.error('File check error:', error);
        throw new Error('Downloaded file not found or invalid');
      }

      // Read file and send as response
      console.log('Reading file for download...');
      const fileBuffer = await fs.readFile(ipaPath);
      console.log('File buffer size:', fileBuffer.length);
      
      // Change content type for file download
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
      res.setHeader('Content-Length', fileBuffer.length);
      
      // Clean up session after successful download
      activeSessions.delete(currentSessionId);
      
      console.log('✅ Sending file download response');
      return res.send(fileBuffer);

    } catch (error) {
      console.error('=== MAIN ERROR DETAILS ===');
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      console.error('Error name:', error.name);
      console.error('Session ID:', currentSessionId);
      console.error('Has 2FA code:', !!twoFactorCode);
      console.error('Process output:', output);
      console.error('===========================');

      let statusCode = 500;
      let errorType = 'SERVER_ERROR';
      let errorMessage = 'Đã xảy ra lỗi hệ thống';

      // More detailed error checking
      const errorLower = (error.message || '').toLowerCase();
      const outputLower = (output || '').toLowerCase();
      
      // Check for specific error types
      if (errorLower.includes('spawn') || errorLower.includes('enoent')) {
        statusCode = 500;
        errorType = 'PROCESS_ERROR';
        errorMessage = 'Không thể khởi động công cụ tải xuống';
      } else if (errorLower.includes('keychain') || outputLower.includes('keychain') ||
          errorLower.includes('security framework') || outputLower.includes('security framework')) {
        statusCode = 500;
        errorType = 'KEYCHAIN_ERROR';
        errorMessage = 'Lỗi hệ thống bảo mật - môi trường không hỗ trợ keychain';
      } else if (errorLower.includes('verification code') || errorLower.includes('two-factor') || errorLower.includes('2fa') ||
          outputLower.includes('verification code') || outputLower.includes('two-factor') || outputLower.includes('2fa')) {
        
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
        debug: {
          originalError: error.message,
          sessionId: currentSessionId,
          hasSession: activeSessions.has(currentSessionId),
          output: output,
          errorStack: error.stack,
          tempDir: tempDir
        }
      });
    }

  } catch (topLevelError) {
    console.error('=== TOP LEVEL ERROR ===');
    console.error('Top level error:', topLevelError);
    console.error('Error stack:', topLevelError.stack);
    console.error('=======================');

    return res.status(500).json({
      error: 'CRITICAL_ERROR',
      message: 'Lỗi nghiêm trọng của hệ thống',
      debug: {
        error: topLevelError.message,
        stack: topLevelError.stack
      }
    });
  } finally {
    console.log('=== CLEANUP ===');
    // Cleanup temp directory
    try {
      const tempDir = path.join('/tmp', `ipa_${sessionId || 'unknown'}`);
      setTimeout(async () => {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
          console.log('✅ Cleanup completed for:', tempDir);
        } catch (cleanupError) {
          console.error('❌ Cleanup error:', cleanupError.message);
        }
      }, 5000);
    } catch (error) {
      console.error('❌ Cleanup scheduling error:', error.message);
    }
    console.log('=== API CALL END ===');
  }
}
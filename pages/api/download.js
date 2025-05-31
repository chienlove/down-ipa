import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);
const sessions = new Map();

// Cleanup old sessions every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.timestamp > 10 * 60 * 1000) {
      sessions.delete(key);
      console.log(`Cleaned up expired session: ${key}`);
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

  try {
    // Create temp directory
    await fs.mkdir(tempDir, { recursive: true });
    await fs.chmod(tempDir, 0o700);

    // Verify ipatool exists
    const ipatoolPath = '/usr/local/bin/ipatool';
    if (!existsSync(ipatoolPath)) {
      return res.status(500).json({
        error: 'TOOL_NOT_FOUND',
        message: 'Không tìm thấy công cụ ipatool'
      });
    }

    // Prepare environment
    const env = {
      ...process.env,
      HOME: tempDir,
      TMPDIR: tempDir,
      KEYCHAIN_PATH: keychainPath
    };

    const is2FARequest = !!twoFactorCode;
    const existingSession = sessions.get(tempSessionId);

    // Handle 2FA request
    if (is2FARequest) {
      if (!existingSession) {
        console.error('Invalid 2FA session:', {
          requestedSession: tempSessionId,
          activeSessions: Array.from(sessions.keys())
        });
        return res.status(400).json({
          error: 'SESSION_EXPIRED',
          message: 'Phiên đã hết hạn. Vui lòng bắt đầu lại từ đầu'
        });
      }

      console.log('Processing 2FA for session:', tempSessionId);
      
      try {
        const { stdout, stderr } = await execFileAsync(
          ipatoolPath,
          [
            'auth', 'complete',
            '--email', existingSession.appleId,
            '--password', existingSession.password,
            '--keychain-passphrase', '',
            '--auth-code', twoFactorCode
          ],
          { 
            env, 
            cwd: tempDir, 
            timeout: 60000,
            maxBuffer: 1024 * 1024 * 5 // 5MB buffer
          }
        );

        console.log('2FA Success:', stdout);
        sessions.delete(tempSessionId);
        
      } catch (error) {
        console.error('2FA Failed:', {
          message: error.message,
          stdout: error.stdout,
          stderr: error.stderr
        });

        let userMessage = 'Xác thực 2FA thất bại';
        const errorOutput = (error.stderr || error.stdout || '').toLowerCase();
        
        if (errorOutput.includes('invalid verification code')) {
          userMessage = 'Mã 2FA không chính xác';
        } else if (errorOutput.includes('expired')) {
          userMessage = 'Mã 2FA đã hết hạn. Vui lòng yêu cầu mã mới';
        } else if (errorOutput.includes('timeout')) {
          userMessage = 'Quá thời gian chờ xác thực. Vui lòng thử lại';
        }

        return res.status(400).json({
          error: 'TWO_FACTOR_FAILED',
          message: userMessage
        });
      }
    } 
    // Handle initial login
    else {
      console.log('Initial login attempt for:', appleId);
      
      try {
        const { stdout, stderr } = await execFileAsync(
          ipatoolPath,
          [
            'auth', 'login',
            '--email', appleId,
            '--password', password,
            '--keychain-passphrase', ''
          ],
          { env, cwd: tempDir, timeout: 60000 }
        );

        console.log('Login Success:', stdout);
        
      } catch (loginError) {
        console.log('Login Error Analysis:', {
          code: loginError.code,
          stdout: loginError.stdout,
          stderr: loginError.stderr
        });

        const allErrorOutput = [
          loginError.stdout || '',
          loginError.stderr || '',
          loginError.message || ''
        ].join(' ').toLowerCase();

        // Check for 2FA requirements
        const require2FAPatterns = [
          'verification code',
          'two-factor',
          'enter the verification code',
          'authentication code',
          'security code',
          'two factor authentication',
          'enter verification code',
          'verification code sent',
          'code has been sent',
          'enter the code',
          'trusted device',
          'sent to your',
          'verify your identity',
          'complete authentication',
          '2fa',
          'verify',
          'code'
        ];

        const needs2FA = require2FAPatterns.some(pattern => 
          allErrorOutput.includes(pattern)
        );

        if (needs2FA) {
          console.log('2FA required for:', appleId);
          sessions.set(tempSessionId, { 
            appleId, 
            password, 
            appId,
            timestamp: Date.now(),
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
          });
          
          return res.status(200).json({
            requiresTwoFactor: true,
            sessionId: tempSessionId,
            message: 'Vui lòng nhập mã 2FA từ thiết bị của bạn'
          });
        }

        // Handle other errors
        let errorMessage = 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin';
        
        if (allErrorOutput.includes('invalid credentials') || 
            allErrorOutput.includes('wrong password') || 
            allErrorOutput.includes('incorrect')) {
          errorMessage = 'Sai Apple ID hoặc mật khẩu';
        } else if (allErrorOutput.includes('account locked') || 
                  allErrorOutput.includes('locked')) {
          errorMessage = 'Tài khoản bị khóa. Vui lòng thử lại sau';
        } else if (allErrorOutput.includes('network') || 
                  allErrorOutput.includes('connection') || 
                  allErrorOutput.includes('timeout')) {
          errorMessage = 'Lỗi kết nối mạng. Vui lòng thử lại';
        }

        return res.status(401).json({
          error: 'AUTH_FAILED',
          message: errorMessage
        });
      }
    }

    // Download IPA after successful auth
    console.log('Starting download for:', appId);
    const ipaPath = path.join(tempDir, `${appId}.ipa`);
    
    try {
      const { stdout, stderr } = await execFileAsync(
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
        throw new Error('File IPA không được tạo thành công');
      }
      
      const fileStats = await fs.stat(ipaPath);
      if (fileStats.size === 0) {
        throw new Error('File IPA rỗng');
      }

      // Stream file to client
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
      res.setHeader('Content-Length', fileStats.size);
      
      const stream = require('fs').createReadStream(ipaPath);
      return stream.pipe(res);

    } catch (downloadError) {
      console.error('Download Failed:', downloadError);
      
      let errorMessage = 'Không thể tải xuống ứng dụng';
      const errorOutput = (downloadError.stdout || downloadError.stderr || '').toLowerCase();
      
      if (errorOutput.includes('not found') || errorOutput.includes('does not exist')) {
        errorMessage = 'Không tìm thấy ứng dụng với Bundle ID này';
      } else if (errorOutput.includes('not purchased') || errorOutput.includes('not available')) {
        errorMessage = 'Ứng dụng chưa được mua hoặc không khả dụng cho tài khoản này';
      }
      
      return res.status(400).json({
        error: 'DOWNLOAD_FAILED',
        message: errorMessage
      });
    }

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: error.message || 'Lỗi hệ thống'
    });
  } finally {
    // Cleanup with delay
    setTimeout(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log('Cleaned up:', tempDir);
      } catch (error) {
        console.warn('Cleanup Error:', error);
      }
    }, 5000);
  }
}
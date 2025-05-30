import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);
const sessions = new Map();

// Cleanup old sessions (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.timestamp > 10 * 60 * 1000) {
      sessions.delete(key);
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

    // Kiểm tra session hiện có
    const existingSession = sessions.get(tempSessionId);

    // Xử lý 2FA
    if (existingSession && twoFactorCode) {
      console.log('Processing 2FA code:', twoFactorCode);
      try {
        const { stdout, stderr } = await execFileAsync(
          ipatoolPath,
          [
            'auth', 'complete',
            '--email', existingSession.appleId,
            '--keychain-passphrase', '',
            '--auth-code', twoFactorCode
          ],
          { env, cwd: tempDir, timeout: 30000 }
        );
        
        console.log('2FA Complete stdout:', stdout);
        console.log('2FA Complete stderr:', stderr);
        
        sessions.delete(tempSessionId);
        
        // Tiếp tục với việc download sau khi 2FA thành công
      } catch (error) {
        console.error('2FA Error:', error);
        console.error('2FA Error stdout:', error.stdout);
        console.error('2FA Error stderr:', error.stderr);
        
        return res.status(400).json({
          error: 'TWO_FACTOR_FAILED',
          message: 'Mã 2FA không hợp lệ hoặc đã hết hạn'
        });
      }
    } 
    // Đăng nhập lần đầu
    else if (!existingSession) {
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

        const output = (stdout + stderr).toLowerCase();
        console.log('Login output:', output);

        // Kiểm tra các patterns yêu cầu 2FA
        const require2FAPatterns = [
          'verification code',
          'two-factor',
          'enter the verification code',
          'please enter the 6-digit verification code',
          'authentication code',
          'security code'
        ];

        const needs2FA = require2FAPatterns.some(pattern => output.includes(pattern));

        if (needs2FA) {
          console.log('2FA required detected');
          sessions.set(tempSessionId, { 
            appleId, 
            password, 
            appId,
            timestamp: Date.now()
          });
          
          return res.status(200).json({
            requiresTwoFactor: true,
            sessionId: tempSessionId,
            message: 'Vui lòng nhập mã 2FA từ thiết bị của bạn'
          });
        }

        // Nếu không cần 2FA, tiếp tục với download
        console.log('Login successful without 2FA');
        
      } catch (error) {
        console.error('Login Error:', error);
        console.error('Login Error stdout:', error.stdout);
        console.error('Login Error stderr:', error.stderr);
        
        const errorOutput = ((error.stdout || '') + (error.stderr || '') + (error.message || '')).toLowerCase();
        
        // Kiểm tra yêu cầu 2FA từ error message
        const require2FAPatterns = [
          'verification code',
          'two-factor',
          'enter the verification code',
          'please enter the 6-digit verification code',
          'authentication code',
          'security code'
        ];

        const needs2FA = require2FAPatterns.some(pattern => errorOutput.includes(pattern));

        if (needs2FA) {
          console.log('2FA required detected from error');
          sessions.set(tempSessionId, { 
            appleId, 
            password, 
            appId,
            timestamp: Date.now()
          });
          
          return res.status(200).json({
            requiresTwoFactor: true,
            sessionId: tempSessionId,
            message: 'Vui lòng nhập mã 2FA từ thiết bị của bạn'
          });
        }

        // Các lỗi khác
        let errorMessage = 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin';
        
        if (errorOutput.includes('invalid credentials') || errorOutput.includes('wrong password')) {
          errorMessage = 'Sai Apple ID hoặc mật khẩu';
        } else if (errorOutput.includes('account locked')) {
          errorMessage = 'Tài khoản bị khóa. Vui lòng thử lại sau';
        } else if (errorOutput.includes('network') || errorOutput.includes('connection')) {
          errorMessage = 'Lỗi kết nối mạng. Vui lòng thử lại';
        }

        return res.status(401).json({
          error: 'AUTH_FAILED',
          message: errorMessage
        });
      }
    }

    // Tải IPA sau khi xác thực thành công
    console.log('Starting IPA download for:', appId);
    try {
      const ipaPath = path.join(tempDir, `${appId}.ipa`);
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

      console.log('Download stdout:', stdout);
      console.log('Download stderr:', stderr);
      
      // Kiểm tra file có tồn tại không
      if (!existsSync(ipaPath)) {
        throw new Error('File IPA không được tạo thành công');
      }
      
      const fileStats = await fs.stat(ipaPath);
      console.log('File size:', fileStats.size);
      
      if (fileStats.size === 0) {
        throw new Error('File IPA rỗng');
      }

      // Stream file về client
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
      res.setHeader('Content-Length', fileStats.size);
      
      const stream = require('fs').createReadStream(ipaPath);
      return stream.pipe(res);

    } catch (downloadError) {
      console.error('Download Error:', downloadError);
      
      let errorMessage = 'Không thể tải xuống ứng dụng';
      const errorOutput = (downloadError.stdout || downloadError.stderr || downloadError.message || '').toLowerCase();
      
      if (errorOutput.includes('not found') || errorOutput.includes('does not exist')) {
        errorMessage = 'Không tìm thấy ứng dụng với Bundle ID này';
      } else if (errorOutput.includes('not purchased') || errorOutput.includes('not available')) {
        errorMessage = 'Ứng dụng chưa được mua hoặc không khả dụng cho tài khoản này';
      } else if (errorOutput.includes('region') || errorOutput.includes('country')) {
        errorMessage = 'Ứng dụng không khả dụng ở khu vực này';
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
    // Cleanup với delay để đảm bảo file đã được stream xong
    setTimeout(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log('Cleaned up temp directory:', tempDir);
      } catch (error) {
        console.warn('Cleanup Error:', error);
      }
    }, 5000);
  }
}
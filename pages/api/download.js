import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);
const sessions = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { appleId, password, appId, twoFactorCode, sessionId } = req.body;
  
  // Validate input
  if (!appleId || !password || !appId) {
    return res.status(400).json({ 
      error: 'MISSING_FIELDS',
      message: 'Thiếu thông tin bắt buộc' 
    });
  }

  const tempSessionId = sessionId || uuidv4();
  const tempDir = path.join('/tmp', `ipa_${tempSessionId}`);
  const keychainPath = path.join(tempDir, 'ipatool.keychain');
  
  try {
    // Create temp directory with proper permissions
    await fs.mkdir(tempDir, { recursive: true });
    await fs.chmod(tempDir, 0o700);

    const ipatoolPath = '/usr/local/bin/ipatool';
    if (!existsSync(ipatoolPath)) {
      return res.status(500).json({
        error: 'TOOL_NOT_FOUND',
        message: 'Không tìm thấy ipatool'
      });
    }

    const env = {
      ...process.env,
      HOME: tempDir,
      TMPDIR: tempDir,
      KEYCHAIN_PATH: keychainPath,
      PATH: `/usr/local/bin:${process.env.PATH}`
    };

    // 1. Check existing session
    const existingSession = sessions.get(tempSessionId);

    // 2. Handle 2FA if required
    if (existingSession) {
      if (!twoFactorCode) {
        return res.status(202).json({
          requiresTwoFactor: true,
          sessionId: tempSessionId,
          message: 'Vui lòng nhập mã 2FA từ thiết bị của bạn'
        });
      }

      // Complete 2FA auth
      try {
        await execFileAsync(
          ipatoolPath,
          [
            'auth', 'complete',
            '--email', appleId,
            '--keychain-passphrase', '',
            '--non-interactive',
            '--auth-code', twoFactorCode
          ],
          { env, cwd: tempDir, timeout: 30000 }
        );
        sessions.delete(tempSessionId);
      } catch (authError) {
        console.error('2FA Error:', authError);
        return res.status(400).json({
          error: 'TWO_FACTOR_FAILED',
          message: 'Mã 2FA không hợp lệ'
        });
      }
    } 
    // 3. Initial login
    else {
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

        // Check for 2FA requirement
        const output = stdout + stderr;
        if (output.includes('verification code') || output.includes('two-factor')) {
          sessions.set(tempSessionId, {
            appleId,
            password,
            appId,
            timestamp: Date.now()
          });
          return res.status(202).json({
            requiresTwoFactor: true,
            sessionId: tempSessionId,
            message: 'Vui lòng nhập mã 2FA từ thiết bị của bạn'
          });
        }
      } catch (loginError) {
        console.error('Login Error:', loginError);
        
        if (loginError.message.includes('verification code') || 
            loginError.stderr?.includes('verification code')) {
          sessions.set(tempSessionId, {
            appleId,
            password,
            appId,
            timestamp: Date.now()
          });
          return res.status(202).json({
            requiresTwoFactor: true,
            sessionId: tempSessionId,
            message: 'Vui lòng nhập mã 2FA từ thiết bị của bạn'
          });
        }

        return res.status(401).json({
          error: 'AUTH_FAILED',
          message: 'Đăng nhập thất bại. Vui lòng kiểm lại thông tin.'
        });
      }
    }

    // 4. After successful auth - download IPA
    const ipaPath = path.join(tempDir, `${appId}.ipa`);
    
    try {
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

      console.log('Download Output:', stdout);
      
      if (!existsSync(ipaPath)) {
        throw new Error('File IPA không được tạo');
      }

      const fileStats = await fs.stat(ipaPath);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
      res.setHeader('Content-Length', fileStats.size);
      
      const fileStream = fs.createReadStream(ipaPath);
      fileStream.pipe(res);
      return;

    } catch (downloadError) {
      console.error('Download Error:', downloadError);
      throw new Error(`Lỗi tải ứng dụng: ${downloadError.message}`);
    }

  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: error.message || 'Lỗi máy chủ nội bộ'
    });
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn('Cleanup Error:', cleanupError.message);
    }
  }
}

// Cleanup old sessions hourly
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.timestamp > 3600000) {
      sessions.delete(sessionId);
    }
  }
}, 3600000);
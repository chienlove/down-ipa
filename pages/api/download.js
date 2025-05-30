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
    await fs.mkdir(tempDir, { recursive: true });
    await fs.chmod(tempDir, 0o700);
  } catch (err) {
    console.warn('Không thể tạo thư mục tạm:', err.message);
  }

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

  try {
    // 1. Kiểm tra session hiện có
    const existingSession = sessions.get(tempSessionId);

    // 2. Xử lý 2FA nếu có session
    if (existingSession) {
      if (!twoFactorCode) {
        return res.status(202).json({
          requiresTwoFactor: true,
          sessionId: tempSessionId,
          message: 'Vui lòng nhập mã 2FA từ thiết bị của bạn'
        });
      }

      // Thực hiện xác thực 2FA
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
        console.error('Lỗi xác thực 2FA:', authError);
        return res.status(400).json({
          error: 'TWO_FACTOR_FAILED',
          message: 'Mã 2FA không hợp lệ'
        });
      }
    } 
    // 3. Đăng nhập lần đầu
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

        // Phát hiện yêu cầu 2FA
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
        console.error('Lỗi đăng nhập:', loginError);
        
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
          message: 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.'
        });
      }
    }

    // 4. Tải IPA sau khi xác thực thành công
    const ipaPath = path.join(tempDir, `${appId}.ipa`);
    
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

    console.log('Download thành công:', stdout);
    
    if (!existsSync(ipaPath)) {
      throw new Error('File IPA không được tạo');
    }

    const fileStats = await fs.stat(ipaPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    res.setHeader('Content-Length', fileStats.size);
    
    const fileStream = fs.createReadStream(ipaPath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Lỗi chính:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: error.message || 'Lỗi máy chủ nội bộ'
    });
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn('Lỗi dọn dẹp:', cleanupError.message);
    }
  }
}

// Dọn session mỗi giờ
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.timestamp > 3600000) {
      sessions.delete(sessionId);
    }
  }
}, 3600000);
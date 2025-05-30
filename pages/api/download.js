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

  let tempDir = null;
  let downloadedFile = null;

  try {
    const { appleId, password, appId, appVerId, twoFactorCode, sessionId } = req.body;

    // Validate required fields
    if (!appleId || !password || !appId) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'Apple ID, mật khẩu và App ID là bắt buộc'
      });
    }

    const tempSessionId = sessionId || uuidv4();
    tempDir = path.join('/tmp', `ipa_${tempSessionId}`);
    const keychainPath = path.join(tempDir, 'ipatool.keychain');

    // Create temp directory
    try {
      await fs.mkdir(tempDir, { recursive: true });
      await fs.chmod(tempDir, 0o700); // Đảm bảo quyền truy cập
    } catch (err) {
      console.warn('Could not create temp directory:', err.message);
      tempDir = '/tmp';
    }

    // Check ipatool exists
    const ipatoolPath = '/usr/local/bin/ipatool';
    if (!existsSync(ipatoolPath)) {
      return res.status(500).json({
        error: 'TOOL_NOT_FOUND',
        message: 'ipatool không tìm thấy'
      });
    }

    // Setup environment
    const env = {
      ...process.env,
      HOME: tempDir,
      TMPDIR: tempDir,
      KEYCHAIN_PATH: keychainPath,
      PATH: `/usr/local/bin:${process.env.PATH}` // Đảm bảo PATH chứa ipatool
    };

    // 1. Kiểm tra session hiện có
    const existingSession = sessions.get(tempSessionId);

    // 2. Xử lý 2FA nếu có session nhưng chưa có mã
    if (existingSession && !twoFactorCode) {
      return res.status(202).json({
        requiresTwoFactor: true,
        sessionId: tempSessionId,
        message: 'Vui lòng nhập mã 2FA'
      });
    }

    // 3. Xác thực 2FA nếu có mã
    if (existingSession && twoFactorCode) {
      try {
        await execFileAsync(
          ipatoolPath,
          [
            'auth', 'complete',
            '--keychain-passphrase', '',
            '--non-interactive',
            '--auth-code', twoFactorCode
          ],
          { env, cwd: tempDir, timeout: 30000 }
        );
        sessions.delete(tempSessionId); // Xóa session sau khi xác thực thành công
      } catch (authError) {
        console.error('2FA Error:', authError);
        return res.status(400).json({
          error: 'TWO_FACTOR_FAILED',
          message: 'Mã 2FA không đúng hoặc đã hết hạn'
        });
      }
    }
    // 4. Đăng nhập nếu không có session
    else if (!existingSession) {
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
        if (stdout.includes('verification code') || stderr.includes('verification code')) {
          sessions.set(tempSessionId, {
            appleId,
            password,
            appId,
            timestamp: Date.now()
          });
          return res.status(202).json({
            requiresTwoFactor: true,
            sessionId: tempSessionId,
            message: 'Vui lòng nhập mã 2FA được gửi đến thiết bị của bạn'
          });
        }

        console.log('Đăng nhập thành công');
      } catch (loginError) {
        console.error('Login Error:', loginError);

        // Phát hiện yêu cầu 2FA từ lỗi
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
            message: 'Vui lòng nhập mã 2FA'
          });
        }

        return res.status(401).json({
          error: 'AUTH_FAILED',
          message: 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.'
        });
      }
    }

    // 5. Tải IPA sau khi xác thực thành công
    const ipaFilename = `${appId}.ipa`;
    const ipaPath = path.join(tempDir, ipaFilename);

    const downloadArgs = [
      'download',
      '--bundle-identifier', appId,
      '--output', ipaPath,
      '--keychain-passphrase', ''
    ];

    if (appVerId) {
      downloadArgs.push('--app-version-id', appVerId);
    }

    try {
      const { stdout } = await execFileAsync(
        ipatoolPath,
        downloadArgs,
        { env, cwd: tempDir, timeout: 300000 }
      );
      console.log('Download Output:', stdout);

      // Kiểm tra file tồn tại
      if (!existsSync(ipaPath)) {
        throw new Error('File IPA không được tạo');
      }

      const fileStats = await fs.stat(ipaPath);
      if (fileStats.size === 0) {
        throw new Error('File IPA rỗng');
      }

      // Trả về file
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${ipaFilename}"`);
      res.setHeader('Content-Length', fileStats.size);

      const fileStream = fs.createReadStream(ipaPath);
      fileStream.pipe(res);

    } catch (downloadError) {
      console.error('Download Error:', downloadError);
      return res.status(500).json({
        error: 'DOWNLOAD_FAILED',
        message: `Lỗi khi tải ứng dụng: ${downloadError.message}`
      });
    }

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Lỗi máy chủ nội bộ'
    });
  } finally {
    // Dọn dẹp
    if (tempDir && tempDir !== '/tmp') {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Cleanup Error:', cleanupError.message);
      }
    }
  }
}

// Dọn session cũ mỗi giờ
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.timestamp > 3600000) { // 1 giờ
      sessions.delete(sessionId);
    }
  }
}, 3600000);
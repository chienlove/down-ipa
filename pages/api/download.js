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
      try {
        await execFileAsync(
          ipatoolPath,
          [
            'auth', 'complete',
            '--email', appleId,
            '--keychain-passphrase', '',
            '--auth-code', twoFactorCode
          ],
          { env, cwd: tempDir, timeout: 30000 }
        );
        sessions.delete(tempSessionId);
      } catch (error) {
        console.error('2FA Error:', error);
        return res.status(400).json({
          error: 'TWO_FACTOR_FAILED',
          message: 'Mã 2FA không hợp lệ'
        });
      }
    } 
    // Đăng nhập lần đầu hoặc yêu cầu 2FA
    else {
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

        // Kiểm tra yêu cầu 2FA
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
      } catch (error) {
        console.error('Login Error:', error);
        
        // Phát hiện yêu cầu 2FA từ lỗi
        if (error.message.includes('verification code') || error.stderr?.includes('verification code')) {
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
          message: 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin'
        });
      }
    }

    // Tải IPA sau khi xác thực thành công
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

    console.log('Download Success:', stdout);
    
    const fileStats = await fs.stat(ipaPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    res.setHeader('Content-Length', fileStats.size);
    
    return fs.createReadStream(ipaPath).pipe(res);

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: error.message || 'Lỗi hệ thống'
    });
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Cleanup Error:', error);
    }
  }
}
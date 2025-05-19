import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const execFileAsync = promisify(execFile);
const sessions = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { appleId, password, appId, appVerId, twoFactorCode, sessionId } = req.body;
    console.log(`Handling request for ${appleId}, has 2FA code: ${!!twoFactorCode}, has sessionId: ${!!sessionId}`);

    // Thiết lập môi trường tạm thời
    process.env.HOME = '/tmp';
    process.env.TMPDIR = '/tmp';

    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755);

    let keychainPassphrase;

    // Xác thực phiên
    if (sessionId && sessions.has(sessionId)) {
      console.log(`Using existing session: ${sessionId}`);
      keychainPassphrase = sessions.get(sessionId);
    } else {
      keychainPassphrase = process.env.KEYCHAIN_PASSPHRASE || 
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      
      const newSessionId = Math.random().toString(36).slice(2);
      sessions.set(newSessionId, keychainPassphrase);
      
      // Xóa phiên sau 10 phút
      setTimeout(() => {
        if (sessions.has(newSessionId)) {
          console.log(`Cleaning up session: ${newSessionId}`);
          sessions.delete(newSessionId);
        }
      }, 10 * 60 * 1000);
      
      if (!twoFactorCode) {
        req.body.sessionId = newSessionId;
      }
    }

    // Xử lý đăng nhập
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase,
      ...(twoFactorCode ? ['--auth-code', twoFactorCode] : []),
    ];

    console.log('Executing login command...');
    const { stdout: loginOutput, stderr: loginError } = await execFileAsync(ipatoolPath, loginArgs, {
      timeout: 60000
    });

    console.log('Login output:', loginOutput);
    if (loginError) console.log('Login error:', loginError);

    if (loginError || !loginOutput.includes('success=true')) {
      if (/2FA|two-factor|auth-code/i.test(loginError || loginOutput)) {
        return res.status(401).json({
          error: '2FA_REQUIRED',
          message: 'Vui lòng nhập mã xác thực 2FA từ thiết bị Apple của bạn.',
          sessionId: req.body.sessionId
        });
      }

      if (loginError && loginError.includes('Invalid verification code')) {
        return res.status(400).json({
          error: 'INVALID_2FA',
          message: 'Mã xác thực không hợp lệ hoặc đã hết hạn.'
        });
      }

      throw new Error(loginError || 'Đăng nhập thất bại');
    }

    // Tải xuống file IPA
    const downloadArgs = [
      'download',
      appVerId ? '--app-id' : '--bundle-identifier',
      appVerId || appId,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase,
      '--purchase',
      '--verbose'
    ];

    console.log('Executing download command with args:', downloadArgs);
    const { stdout: downloadOutput, stderr: downloadError } = await execFileAsync(ipatoolPath, downloadArgs, {
      timeout: 300000
    });

    console.log('Download output:', downloadOutput);
    if (downloadError) console.log('Download error:', downloadError);

    const ipaPath = downloadOutput.trim().split('\n')
      .reverse()
      .find(line => line.trim().endsWith('.ipa'))?.trim();

    console.log('Detected IPA path:', ipaPath);

    if (!ipaPath || !existsSync(ipaPath)) {
      throw new Error('Không tìm thấy file IPA');
    }

    const ipaContent = await fs.readFile(ipaPath);
    console.log(`Read IPA file, size: ${ipaContent.length} bytes`);
    await fs.unlink(ipaPath).catch(() => {});

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId || 'app'}.ipa"`);
    res.setHeader('Content-Length', ipaContent.length);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Error during execution:', error);
    const errorMessage = error.stderr || error.stdout || error.message;
    
    return res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      message: 'Tải xuống thất bại',
      details: errorMessage
    });
  }
}
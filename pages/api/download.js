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
    let currentSessionId = sessionId;

    // Xử lý session
    if (currentSessionId && sessions.has(currentSessionId)) {
      console.log(`Using existing session: ${currentSessionId}`);
      keychainPassphrase = sessions.get(currentSessionId);
    } else {
      keychainPassphrase = process.env.KEYCHAIN_PASSPHRASE || 
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      
      currentSessionId = Math.random().toString(36).slice(2);
      sessions.set(currentSessionId, keychainPassphrase);
      
      // Xóa phiên sau 10 phút
      setTimeout(() => {
        if (sessions.has(currentSessionId)) {
          console.log(`Cleaning up session: ${currentSessionId}`);
          sessions.delete(currentSessionId);
        }
      }, 10 * 60 * 1000);
      
      console.log(`Created new session: ${currentSessionId}`);
    }

    // Xử lý đăng nhập với verbose và JSON format
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase,
      '--verbose',
      '--format', 'json',
      ...(twoFactorCode ? ['--auth-code', twoFactorCode] : []),
    ];

    console.log('Executing login command with args:', loginArgs);
    let loginOutput, loginError;
    
    try {
      const result = await execFileAsync(ipatoolPath, loginArgs, {
        timeout: 120000 // 2 phút timeout cho 2FA
      });
      loginOutput = result.stdout;
      loginError = result.stderr;
    } catch (error) {
      loginOutput = error.stdout;
      loginError = error.stderr;
    }

    console.log('Login stdout:', loginOutput);
    console.log('Login stderr:', loginError);

    let loginResult;
    try {
      loginResult = JSON.parse(loginOutput);
    } catch {
      loginResult = { success: loginOutput.includes('success=true') };
    }

    if (!loginResult.success) {
      if (/2FA|two-factor|auth-code/i.test(loginError || loginOutput)) {
        return res.status(401).json({
          error: '2FA_REQUIRED',
          message: 'Vui lòng nhập mã xác thực 2FA từ thiết bị Apple của bạn.',
          sessionId: currentSessionId
        });
      }

      if (loginError && loginError.includes('Invalid verification code')) {
        return res.status(400).json({
          error: 'INVALID_2FA',
          message: 'Mã xác thực không hợp lệ hoặc đã hết hạn.',
          sessionId: currentSessionId
        });
      }

      throw new Error(loginError || 'Đăng nhập thất bại');
    }

    console.log('Login successful, proceeding to download...');

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
      timeout: 300000 // 5 phút timeout cho download
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
      details: errorMessage.toString()
    });
  }
}
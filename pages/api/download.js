import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { appleId, password, appId, twoFactorCode } = req.body;
    console.log('Request received:', { appleId, appId, twoFactorCode: !!twoFactorCode });

    // Chuẩn bị ipatool
    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755);

    // Thiết lập HOME riêng biệt
    const tmpHome = path.join('/tmp', `ipatool-home-${Date.now()}`);
    await fs.mkdir(tmpHome, { recursive: true });
    process.env.HOME = tmpHome;

    // Tạo passphrase ngẫu nhiên cho keychain
    const keychainPassphrase = Math.random().toString(36).substring(2, 15) + 
                              Math.random().toString(36).substring(2, 15);

    // Luôn đăng nhập ngay trước khi tải
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase
    ];

    // Thay đổi cách truyền mã xác thực 2FA
    if (twoFactorCode) {
      // Sử dụng tham số --auth-code đúng với phiên bản ipatool 2.1.6
      loginArgs.push('--auth-code', twoFactorCode);
    }

    console.log('Logging in with args:', loginArgs);
    const { stdout, stderr } = await execFileAsync(ipatoolPath, loginArgs, {
      timeout: 30000
    });

    console.log('Login output:', stdout);
    if (stderr) console.error('Login stderr:', stderr);

    if (!stdout.includes('Login successful')) {
      throw new Error(stderr || stdout || 'Login failed');
    }

    // Tiếp tục tải IPA
    console.log('Starting download...');
    const downloadArgs = [
      'download',
      '--bundle-identifier', appId,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase
    ];

    const { stdout: downloadOutput } = await execFileAsync(ipatoolPath, downloadArgs, {
      timeout: 120000
    });

    console.log('Download output:', downloadOutput);
    
    // Tìm đường dẫn tệp IPA trong kết quả
    const outputLines = downloadOutput.trim().split('\n');
    const downloadPath = outputLines[outputLines.length - 1];
    
    if (!downloadPath || !downloadPath.endsWith('.ipa')) {
      throw new Error(`Invalid IPA path: ${downloadPath}`);
    }

    console.log('IPA path:', downloadPath);
    const ipaContent = await fs.readFile(downloadPath);
    await fs.unlink(downloadPath);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Error:', error);
    const rawMessage = error?.stderr || error?.stdout || error?.message || '';
    const lower = rawMessage.toLowerCase();

    if (/two[- ]?factor|2fa|verification code|auth[- ]?code|keyring|get account/.test(lower)) {
      return res.status(401).json({
        error: '2FA_REQUIRED',
        message: 'Cần xác thực hai yếu tố (2FA). Vui lòng nhập mã từ thiết bị Apple của bạn.',
        details: rawMessage
      });
    }

    return res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      message: 'Tải xuống thất bại',
      details: rawMessage
    });
  }
}
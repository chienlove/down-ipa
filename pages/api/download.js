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

    // Luôn đăng nhập ngay trước khi tải
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password,
      '--non-interactive'
    ];

    if (twoFactorCode) {
      loginArgs.push('--verification-code', twoFactorCode);
    }

    console.log('Logging in...');
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
      '--bundle-identifier', appId
    ];

    const { stdout: downloadOutput } = await execFileAsync(ipatoolPath, downloadArgs, {
      timeout: 120000
    });

    const downloadPath = downloadOutput.trim().split('\n').pop();
    if (!downloadPath.endsWith('.ipa')) {
      throw new Error(`Invalid IPA path: ${downloadPath}`);
    }

    const ipaContent = await fs.readFile(downloadPath);
    await fs.unlink(downloadPath);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Error:', error);
    const rawMessage = error?.stderr || error?.stdout || error?.message || '';
    const lower = rawMessage.toLowerCase();

    if (/two[- ]?factor|2fa|verification code|keyring|get account/.test(lower)) {
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
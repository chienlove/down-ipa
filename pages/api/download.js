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
    const { appleId, password, appId, appVerId, twoFactorCode } = req.body;
    console.log('Request received:', { appleId, appId, twoFactorCode: !!twoFactorCode });

    // Chuẩn bị ipatool
    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755);

    // Thiết lập môi trường
    process.env.HOME = '/tmp';

    // Bước 1: Đăng nhập
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password,
      '--non-interactive'
    ];

    if (twoFactorCode) {
      loginArgs.push('--verification-code', twoFactorCode);
    }

    try {
      // Giảm timeout cho lần thử đầu
      const { stdout, stderr } = await execFileAsync(ipatoolPath, loginArgs, {
        timeout: twoFactorCode ? 30000 : 10000
      });

      console.log('Login output:', stdout);
      if (stderr) console.error('Login stderr:', stderr);

      // Kiểm tra kết quả đăng nhập
      if (stdout.includes('Login successful') || !stderr) {
        console.log('Authentication successful');
      } else {
        throw new Error(stderr || stdout);
      }

    } catch (loginError) {
      const errorOutput = (loginError.stderr || loginError.stdout || loginError.message).toString();
      console.error('Login error:', errorOutput);

      // Phát hiện yêu cầu 2FA
      if (errorOutput.includes('two-factor') || 
          errorOutput.includes('2FA') || 
          errorOutput.includes('verification code')) {
        
        const message = errorOutput.includes('sent to') 
          ? errorOutput.match(/sent to (.*)/)?.[0] || 'Mã xác thực đã được gửi đến thiết bị của bạn'
          : 'Vui lòng nhập mã xác thực 2FA từ thiết bị Apple';
        
        return res.status(401).json({ 
          error: '2FA_REQUIRED',
          message,
          details: errorOutput
        });
      }
      
      throw new Error(`Đăng nhập thất bại: ${errorOutput}`);
    }

    // Bước 2: Tải IPA
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
    return res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      message: error.message.includes('2FA') 
        ? 'Xác thực 2FA không thành công' 
        : 'Tải xuống thất bại',
      details: error.message
    });
  }
}
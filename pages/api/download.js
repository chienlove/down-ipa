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
    const { appleId, password, appId, appVerId, verificationCode } = req.body;
    console.log('Request received:', { appleId, appId, hasVerificationCode: !!verificationCode });

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
      '--password', password
    ];

    if (verificationCode) {
      loginArgs.push('--verification-code', verificationCode);
      console.log('Using 2FA verification code');
    }

    try {
      const { stdout, stderr } = await execFileAsync(ipatoolPath, loginArgs, {
        timeout: 30000
      });

      console.log('Login output:', stdout);
      if (stderr) console.error('Login error:', stderr);

      // Kiểm tra xem có cần mã 2FA không
      if (stdout.includes('Enter the 6 digit code') || stderr.includes('two-factor')) {
        return res.status(401).json({
          error: '2FA required',
          details: 'Mã xác thực đã được gửi đến thiết bị Apple của bạn. Vui lòng nhập mã 6 số.'
        });
      }

    } catch (loginError) {
      const errorOutput = (loginError.stderr || loginError.stdout || loginError.message || '').toString();
      console.error('Login error details:', errorOutput);

      if (errorOutput.includes('two-factor') || errorOutput.includes('2FA') || 
          errorOutput.includes('verification') || errorOutput.includes('code')) {
        return res.status(401).json({
          error: '2FA required',
          details: errorOutput.includes('sent') 
            ? errorOutput.match(/sent.*device/)?.[0] || 'Mã xác thực đã được gửi đến thiết bị Apple của bạn'
            : 'Vui lòng kiểm tra thiết bị Apple của bạn để lấy mã xác thực'
        });
      }
      throw new Error(`Đăng nhập thất bại: ${errorOutput}`);
    }

    // Bước 2: Tải IPA
    const downloadArgs = [
      'download',
      '--bundle-identifier', appId,
      '--version', appVerId
    ];

    console.log('Starting download...');
    const { stdout } = await execFileAsync(ipatoolPath, downloadArgs, { 
      timeout: 120000
    });
    
    const downloadPath = stdout.trim().split('\n').pop();
    if (!downloadPath.endsWith('.ipa')) {
      throw new Error(`Không tìm thấy file IPA: ${downloadPath}`);
    }

    const ipaContent = await fs.readFile(downloadPath);
    await fs.unlink(downloadPath);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      error: 'Tải xuống thất bại',
      details: error.message.includes('2FA') 
        ? 'Xác thực 2FA không thành công' 
        : error.message
    });
  }
}
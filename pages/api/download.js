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

    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755);

    process.env.HOME = '/tmp';

    // Bước 1: Đăng nhập
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password
    ];
    
    // Sử dụng --verification-code thay vì --code
    if (verificationCode) {
      loginArgs.push('--verification-code', verificationCode);
      console.log('Using 2FA verification code');
    }

    try {
      // Giảm timeout cho lần thử đầu tiên
      const loginTimeout = verificationCode ? 30000 : 15000;
      const { stdout: loginOut } = await execFileAsync(ipatoolPath, loginArgs, { 
        timeout: loginTimeout 
      });
      console.log('Login success:', loginOut);
    } catch (loginError) {
      const errorOutput = (loginError.stderr || loginError.stdout || loginError.message || '').toString();
      console.log('Raw login error:', loginError);
      console.error('Login error output:', errorOutput);

      if (errorOutput.includes('two-factor') || errorOutput.includes('2FA') || errorOutput.includes('verification')) {
        return res.status(401).json({ 
          error: '2FA required',
          details: 'Vui lòng nhập mã xác thực 2FA từ thiết bị Apple của bạn'
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

    console.log('Starting download with args:', downloadArgs);
    const { stdout } = await execFileAsync(ipatoolPath, downloadArgs, { timeout: 120000 });
    const downloadPath = stdout.trim().split('\n').pop();
    
    if (!downloadPath.endsWith('.ipa')) {
      throw new Error(`Đường dẫn IPA không hợp lệ: ${downloadPath}`);
    }

    const ipaContent = await fs.readFile(downloadPath);
    await fs.unlink(downloadPath);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Full error:', error);
    return res.status(500).json({
      error: 'Tải xuống thất bại',
      details: error.message
    });
  }
}
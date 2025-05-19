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
    const cookieDir = path.join('/tmp', '.ipatool');
    await fs.mkdir(cookieDir, { recursive: true });

    // Bước 1: Đăng nhập với 2FA
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password,
      '--cookie-directory', cookieDir
    ];

    if (verificationCode) {
      loginArgs.push('--verification-code', verificationCode);
      console.log('Using 2FA verification code');
    }

    try {
      const { stdout: loginOut, stderr: loginErr } = await execFileAsync(ipatoolPath, loginArgs, { 
        timeout: 30000,
        env: {
          ...process.env,
          IPATOOL_COOKIE_DIRECTORY: cookieDir
        }
      });
      
      if (loginErr && loginErr.includes('ERROR')) {
        throw new Error(loginErr);
      }
      console.log('Login success:', loginOut);
    } catch (loginError) {
      const errorOutput = (loginError.stderr || loginError.stdout || loginError.message || '').toString();
      console.error('Login error:', errorOutput);

      if (errorOutput.includes('two-factor') || errorOutput.includes('2FA') || 
          errorOutput.includes('verification') || errorOutput.includes('code')) {
        return res.status(401).json({ 
          error: '2FA required',
          details: verificationCode 
            ? 'Mã xác thực không đúng hoặc đã hết hạn. Vui lòng thử lại.' 
            : 'Vui lòng nhập mã xác thực 2FA từ thiết bị Apple của bạn'
        });
      }
      throw new Error(`Đăng nhập thất bại: ${errorOutput}`);
    }

    // Bước 2: Tải IPA
    const downloadArgs = [
      'download',
      '--bundle-identifier', appId,
      '--version', appVerId,
      '--cookie-directory', cookieDir
    ];

    console.log('Starting download...');
    const { stdout } = await execFileAsync(ipatoolPath, downloadArgs, { 
      timeout: 120000,
      env: {
        ...process.env,
        IPATOOL_COOKIE_DIRECTORY: cookieDir
      }
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
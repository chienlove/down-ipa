import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const execFileAsync = promisify(execFile);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { appleId, password, appId, appVerId, twoFactorCode } = req.body;
    
    // Thiết lập môi trường
    process.env.HOME = '/tmp';
    process.env.TMPDIR = '/tmp';

    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755);

    // Tạo một passphrase duy nhất cho mỗi phiên
    const keychainPassphrase = process.env.KEYCHAIN_PASSPHRASE || 
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

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

    // Kiểm tra kết quả đăng nhập
    console.log('Login output:', loginOutput);
    if (loginError) console.log('Login error:', loginError);

    if (loginError || !loginOutput.includes('success=true')) {
      if (/2FA|two-factor|auth-code/i.test(loginError || loginOutput)) {
        return res.status(401).json({
          error: '2FA_REQUIRED',
          message: 'Vui lòng nhập mã xác thực 2FA từ thiết bị Apple của bạn.'
        });
      }
      throw new Error(loginError || 'Đăng nhập thất bại');
    }

    // Sau khi đăng nhập thành công, tiến hành tải xuống
    console.log('Login successful, proceeding to download...');
    const downloadArgs = [
      'download',
      appVerId ? '--app-id' : '--bundle-identifier',
      appVerId || appId,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase,
      '--purchase',
      '--verbose'
    ];

    console.log('Executing download command...');
    const { stdout: downloadOutput, stderr: downloadError } = await execFileAsync(ipatoolPath, downloadArgs, {
      timeout: 180000
    });

    console.log('Download output:', downloadOutput);
    if (downloadError) console.log('Download error:', downloadError);

    // Tìm đường dẫn file IPA trong output
    const ipaPath = downloadOutput.trim().split('\n')
      .reverse()
      .find(line => line.trim().endsWith('.ipa'))?.trim();

    console.log('Detected IPA path:', ipaPath);

    if (!ipaPath || !existsSync(ipaPath)) {
      throw new Error('Không tìm thấy file IPA');
    }

    // Đọc nội dung file và gửi về client
    const ipaContent = await fs.readFile(ipaPath);
    await fs.unlink(ipaPath).catch(() => {});

    // Quan trọng: Không trả về JSON mà trả về file trực tiếp
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId || 'app'}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error.stderr || error.stdout || error.message;
    
    return res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      message: 'Tải xuống thất bại',
      details: errorMessage
    });
  }
}
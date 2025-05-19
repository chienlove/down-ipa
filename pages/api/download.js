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

    console.log('Login with args:', loginArgs.filter(arg => !arg.includes('password')));
    try {
      const { stdout, stderr } = await execFileAsync(ipatoolPath, loginArgs, {
        timeout: 60000  // Tăng timeout lên 1 phút
      });

      console.log('Login output:', stdout);
      if (stderr) console.error('Login stderr:', stderr);

      if (!stdout.includes('Login successful') && !stdout.includes('success=true')) {
        throw new Error(stderr || stdout || 'Login failed');
      }
    } catch (loginErr) {
      console.error('Login error:', loginErr);
      throw loginErr;
    }

    // Tiếp tục tải IPA
    console.log('Starting download...');
    
    // Thêm flag --purchase để đảm bảo ứng dụng được mua nếu cần
    const downloadArgs = [
      'download',
      '--bundle-identifier', appId,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase,
      '--purchase',
      '--verbose'
    ];
    
    console.log('Download command:', downloadArgs);
    
    try {
      const { stdout: downloadOutput, stderr: downloadError } = await execFileAsync(ipatoolPath, downloadArgs, {
        timeout: 180000 // Tăng timeout lên 3 phút
      });

      console.log('Download stdout:', downloadOutput);
      if (downloadError) console.error('Download stderr:', downloadError);
      
      // Kiểm tra nếu có lỗi trong output
      if (downloadError && downloadError.includes('error')) {
        throw new Error(`Download error: ${downloadError}`);
      }
      
      // Tìm đường dẫn tệp IPA trong kết quả
      const outputLines = downloadOutput.trim().split('\n');
      let downloadPath = null;
      
      // Tìm dòng cuối cùng có chứa đuôi .ipa
      for (let i = outputLines.length - 1; i >= 0; i--) {
        if (outputLines[i].trim().endsWith('.ipa')) {
          downloadPath = outputLines[i].trim();
          break;
        }
      }
      
      if (!downloadPath) {
        console.error('Could not find IPA path in output. Full output:', downloadOutput);
        throw new Error('Could not find IPA path in output');
      }

      console.log('Found IPA path:', downloadPath);
      
      // Kiểm tra xem tệp có tồn tại hay không
      try {
        await fs.access(downloadPath);
      } catch (err) {
        console.error(`IPA file not found at ${downloadPath}:`, err);
        throw new Error(`IPA file not found at ${downloadPath}`);
      }
      
      const ipaContent = await fs.readFile(downloadPath);
      console.log(`Read ${ipaContent.length} bytes from IPA file`);
      
      try {
        await fs.unlink(downloadPath);
        console.log('Deleted IPA file after reading');
      } catch (unlinkErr) {
        console.warn('Warning: Could not delete IPA file:', unlinkErr);
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
      return res.send(ipaContent);
    } catch (downloadErr) {
      console.error('Download error:', downloadErr);
      throw downloadErr;
    }

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
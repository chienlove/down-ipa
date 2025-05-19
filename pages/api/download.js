import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);
const sessions = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { appleId, password, appId, appVerId, twoFactorCode, sessionId } = req.body;
    console.log(`Handling request for ${appleId}, 2FA: ${twoFactorCode || 'none'}, Session: ${sessionId || 'new'}`);

    // Thiết lập môi trường
    process.env.HOME = '/tmp';
    process.env.TMPDIR = '/tmp';

    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755);

    // Quản lý session với cơ chế giống code mẫu
    let keychainPassphrase;
    let currentSessionId = sessionId;

    if (currentSessionId && sessions.has(currentSessionId)) {
      console.log(`Reusing session: ${currentSessionId}`);
      keychainPassphrase = sessions.get(currentSessionId);
    } else {
      keychainPassphrase = process.env.KEYCHAIN_PASSPHRASE || 
        Math.random().toString(36).slice(2, 18);
      currentSessionId = uuidv4(); // Sử dụng uuid thay cho random string
      sessions.set(currentSessionId, keychainPassphrase);
      setTimeout(() => sessions.delete(currentSessionId), 30 * 60 * 1000); // 30 phút
      console.log(`Created new session: ${currentSessionId}`);
    }

    // Xử lý đăng nhập với cơ chế 2FA như code mẫu
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase,
      '--verbose',
      ...(twoFactorCode ? ['--auth-code', twoFactorCode] : [])
    ];

    console.log('Executing login command:', loginArgs.join(' '));
    const { stdout: loginOutput, stderr: loginError } = await execFileAsync(ipatoolPath, loginArgs, {
      timeout: 120000
    });

    // Phân tích kết quả theo cách code mẫu xử lý
    console.log('Login output:', loginOutput);
    if (loginError) console.log('Login error:', loginError);

    if (loginError || !loginOutput.includes('success=true')) {
      if (/2FA|two-factor|auth-code/i.test(loginError || loginOutput)) {
        return res.status(401).json({
          error: '2FA_REQUIRED',
          message: 'Vui lòng kiểm tra thiết bị Apple và nhập mã xác thực 2FA',
          sessionId: currentSessionId
        });
      }

      if (loginError && loginError.includes('Invalid verification code')) {
        return res.status(400).json({
          error: 'INVALID_2FA',
          message: 'Mã xác thực không hợp lệ hoặc đã hết hạn',
          sessionId: currentSessionId
        });
      }

      throw new Error(loginError || 'Đăng nhập thất bại');
    }

    console.log('Login successful, proceeding to download...');

    // Tải xuống với cơ chế tương tự code mẫu
    const downloadArgs = [
      'download',
      appVerId ? '--app-id' : '--bundle-identifier',
      appVerId || appId,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase,
      '--purchase',
      '--verbose'
    ];

    console.log('Executing download command:', downloadArgs.join(' '));
    const { stdout: downloadOutput, stderr: downloadError } = await execFileAsync(ipatoolPath, downloadArgs, {
      timeout: 300000
    });

    console.log('Download output:', downloadOutput);
    if (downloadError) console.error('Download error:', downloadError);

    const ipaPath = downloadOutput.split('\n')
      .reverse()
      .find(line => line.trim().endsWith('.ipa'))?.trim();

    if (!ipaPath || !existsSync(ipaPath)) {
      throw new Error('Không tìm thấy file IPA trong output');
    }

    // Tạo thư mục tạm và di chuyển file IPA
    const downloadDir = path.join('/tmp', 'downloads', uuidv4());
    await fs.mkdir(downloadDir, { recursive: true });
    const fileName = `${appId || 'app'}_${Date.now()}.ipa`;
    const newPath = path.join(downloadDir, fileName);
    await fs.rename(ipaPath, newPath);

    // Đọc file và gửi về client
    const ipaContent = await fs.readFile(newPath);
    
    // Xóa file sau khi gửi (cơ chế như code mẫu)
    setTimeout(async () => {
      try {
        await fs.unlink(newPath);
        await fs.rmdir(downloadDir);
        console.log(`Cleaned up: ${newPath}`);
      } catch (err) {
        console.error('Cleanup error:', err);
      }
    }, 30 * 60 * 1000); // 30 phút

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Error:', error);
    const errorDetails = error.stderr || error.stdout || error.message;
    
    return res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      message: 'Tải xuống thất bại',
      details: errorDetails.toString()
    });
  }
}
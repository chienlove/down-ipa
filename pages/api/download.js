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
    console.log('Request received:', { appleId, appId });

    // 1. Thiết lập môi trường /tmp (BẮT BUỘC trên Vercel)
    process.env.HOME = '/tmp';
    process.env.TMPDIR = '/tmp';

    // 2. Chuẩn bị ipatool
    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755); // Quyền thực thi

    // 3. Tạo passphrase ngẫu nhiên cho keychain
    const keychainPassphrase = process.env.KEYCHAIN_PASSPHRASE || 
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

    // 4. Đăng nhập với Apple ID
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase,
      ...(twoFactorCode ? ['--auth-code', twoFactorCode] : []), // Xử lý 2FA
    ];

    console.log('Login command:', loginArgs.filter(arg => arg !== password));
    const { stdout: loginOutput } = await execFileAsync(ipatoolPath, loginArgs, {
      timeout: 60000
    });

    if (!loginOutput.includes('success=true')) {
      throw new Error('Đăng nhập thất bại');
    }

    // 5. Tải IPA
    const downloadArgs = [
      'download',
      appVerId ? '--app-id' : '--bundle-identifier',
      appVerId || appId,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase,
      '--purchase',
      '--verbose'
    ];

    console.log('Download command:', downloadArgs);
    const { stdout: downloadOutput } = await execFileAsync(ipatoolPath, downloadArgs, {
      timeout: 180000
    });

    // 6. Tìm đường dẫn file IPA trong kết quả
    const ipaPath = downloadOutput.trim().split('\n')
      .reverse()
      .find(line => line.trim().endsWith('.ipa'))?.trim();

    if (!ipaPath || !existsSync(ipaPath)) {
      throw new Error('Không tìm thấy file IPA sau khi tải');
    }

    // 7. Đọc và trả về file
    const ipaContent = await fs.readFile(ipaPath);
    await fs.unlink(ipaPath).catch(() => {}); // Xóa file tạm

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error.stderr || error.stdout || error.message;

    if (/2FA|two-factor|auth-code/i.test(errorMessage)) {
      return res.status(401).json({
        error: '2FA_REQUIRED',
        message: 'Vui lòng nhập mã xác thực 2FA',
      });
    }

    return res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      message: 'Tải xuống thất bại',
      details: errorMessage
    });
  }
}
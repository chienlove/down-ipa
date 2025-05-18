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
    const { appleId, password, appId, appVerId, code } = req.body;

    // 1. Đường dẫn ipatool binary
    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755);

    // 2. Thiết lập HOME để lưu session
    process.env.HOME = '/tmp';

    // 3. Đăng nhập để tạo session
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password
    ];
    if (code) loginArgs.push('--code', code);

    console.log('Logging in with:', [ipatoolPath, ...loginArgs].join(' '));

    const { stdout: loginOut } = await execFileAsync(ipatoolPath, loginArgs, { timeout: 30000 });
    console.log('Login output:', loginOut);

    // 4. Tải IPA (sau khi đã login thành công)
    const downloadArgs = [
      'download',
      '--bundle-identifier', appId,
      '--version', appVerId
    ];

    console.log('Downloading with:', [ipatoolPath, ...downloadArgs].join(' '));

    const { stdout, stderr } = await execFileAsync(ipatoolPath, downloadArgs, { timeout: 120000 });

    const downloadPath = stdout.trim().split('\n').pop(); // Lấy dòng cuối là đường dẫn file IPA
    if (!downloadPath.endsWith('.ipa')) {
      throw new Error(`Invalid IPA path: ${downloadPath}`);
    }

    const ipaContent = await fs.readFile(downloadPath);
    await fs.unlink(downloadPath);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Full error:', error);
    return res.status(500).json({
      error: 'Download failed',
      details: error.message,
      solution: 'Đảm bảo bạn đã cung cấp đúng thông tin và ipatool 2.1.6 đang được dùng. Có thể thử chạy ./ipatool --help để kiểm tra.'
    });
  }
}
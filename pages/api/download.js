// pages/api/download.js
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

    // 1. Đường dẫn binary
    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755);

    // 2. Thiết lập môi trường
    process.env.HOME = '/tmp';

    // 3. Chuẩn bị lệnh ĐÚNG cho ipatool 2.1.6
    const args = [
      'download',
      '--bundle-identifier', appId,       // Lưu ý: --bundle-id thay vì --bundle-identifier
      '--email', appleId,          // Một số bản dùng --username thay vì --email
      '--password', password,
      '--version', appVerId        // --version thay vì --app-version
    ];

    if (code) args.push('--code', code);

    console.log('Executing command:', [ipatoolPath, ...args].join(' '));

    // 4. Thực thi
    const { stdout, stderr } = await execFileAsync(
      ipatoolPath,
      args,
      { timeout: 120000 }
    );

    // 5. Xử lý kết quả
    const downloadPath = stdout.trim();
    if (!downloadPath.endsWith('.ipa')) {
      throw new Error(`Invalid IPA path: ${stdout}`);
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
      solution: 'Kiểm tra lại flag bằng cách chạy: ./ipatool --help'
    });
  }
}
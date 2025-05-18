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
    
    // 2. Copy binary từ public sang /tmp (Vercel chỉ cho phép ghi vào /tmp)
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755); // Cấp quyền thực thi

    // 3. Thiết lập biến môi trường
    process.env.HOME = '/tmp'; // Bắt buộc để ghi config

    // 4. Chuẩn bị lệnh cho ipatool 2.1.6
    const args = [
      'download',
      '--bundle-identifier', appId,
      '--email', appleId,
      '--password', password,
      '--app-version', appVerId
    ];

    // Thêm 2FA code nếu có
    if (code) args.push('--code', code);

    console.log('Executing:', ipatoolPath, args.join(' '));

    // 5. Thực thi ipatool
    const { stdout, stderr } = await execFileAsync(
      ipatoolPath,
      args,
      { 
        timeout: 120000, // 120 giây timeout
        env: process.env
      }
    );

    // 6. Xử lý output (ipatool 2.1.6 xuất ra đường dẫn file IPA)
    const downloadPath = stdout.trim();
    if (!downloadPath.endsWith('.ipa')) {
      throw new Error(`Invalid output: ${stdout}`);
    }

    // 7. Đọc và trả về file
    const ipaContent = await fs.readFile(downloadPath);
    
    // 8. Dọn dẹp
    await Promise.all([
      fs.unlink(downloadPath),
      fs.unlink(ipatoolPath)
    ]);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Download failed',
      details: error.message,
      solution: 'Kiểm tra phiên bản ipatool 2.1.6 linux-amd64 và thử lại'
    });
  }
}
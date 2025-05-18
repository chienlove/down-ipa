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

    // 1. Chuẩn bị đường dẫn
    const ipatoolPath = path.join(process.cwd(), 'public', 'bin', 'ipatool');
    const tmpDir = '/tmp';
    const tmpIpatoolPath = path.join(tmpDir, 'ipatool');
    
    // 2. Copy binary sang /tmp và cấp quyền
    await fs.copyFile(ipatoolPath, tmpIpatoolPath);
    await fs.chmod(tmpIpatoolPath, 0o755);

    // 3. Thiết lập biến môi trường
    process.env.HOME = tmpDir; // Bắt buộc: để ipatool ghi config vào /tmp
    process.env.IPATOOL_CONFIG_DIR = path.join(tmpDir, '.ipatool'); // Tùy chỉnh thư mục config

    // 4. Tạo thư mục config trước
    await fs.mkdir(process.env.IPATOOL_CONFIG_DIR, { recursive: true });

    // 5. Chuẩn bị lệnh thực thi
    const args = [
      'download',
      '--bundle-identifier',
      appId,
      '--email',
      appleId,
      '--password',
      password,
      '--app-version',
      appVerId
    ];

    if (code) args.push('--code', code);

    console.log('Executing:', tmpIpatoolPath, args.join(' '));

    // 6. Thực thi ipatool
    const { stdout, stderr } = await execFileAsync(
      tmpIpatoolPath,
      args,
      { 
        timeout: 60000,
        env: process.env // Truyền đầy đủ biến môi trường
      }
    );

    // 7. Xử lý kết quả
    const downloadPath = stdout.trim().split('\n')
      .find(line => line.endsWith('.ipa'));

    if (!downloadPath) {
      throw new Error('IPA path not found in output: ' + stdout);
    }

    // 8. Đọc và trả về file
    const ipaContent = await fs.readFile(downloadPath);
    
    // 9. Dọn dẹp
    await Promise.all([
      fs.unlink(downloadPath),
      fs.unlink(tmpIpatoolPath),
      fs.rm(process.env.IPATOOL_CONFIG_DIR, { recursive: true })
    ]);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Download failed',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
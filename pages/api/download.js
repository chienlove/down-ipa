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
    const ipatoolPath = path.join('/tmp', 'ipatool');
    
    // 2. Copy binary sang /tmp (nếu chưa có)
    try {
      await fs.access(ipatoolPath);
    } catch {
      const sourcePath = path.join(process.cwd(), 'public', 'bin', 'ipatool');
      await fs.copyFile(sourcePath, ipatoolPath);
      await fs.chmod(ipatoolPath, 0o755);
    }

    // 3. Thiết lập môi trường
    process.env.HOME = '/tmp';

    // 4. Tạo file config tạm (nếu cần)
    const configDir = path.join('/tmp', '.ipatool');
    await fs.mkdir(configDir, { recursive: true });

    // 5. Chuẩn bị lệnh thực thi (phiên bản mới dùng --session-info)
    const sessionInfo = {
      email: appleId,
      password: password,
      bundleIdentifier: appId,
      appVersion: appVerId,
      code: code || ''
    };

    const { stdout, stderr } = await execFileAsync(
      ipatoolPath,
      [
        'download',
        '--bundle-identifier', appId,
        '--session-info', JSON.stringify(sessionInfo)
      ],
      { timeout: 60000 }
    );

    // 6. Xử lý kết quả
    const downloadPath = stdout.trim();
    if (!downloadPath.endsWith('.ipa')) {
      throw new Error('Invalid IPA path: ' + stdout);
    }

    const ipaContent = await fs.readFile(downloadPath);
    await fs.unlink(downloadPath);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Download failed',
      details: error.message.includes('unknown flag') 
        ? 'Phiên bản ipatool không tương thích. Vui lòng dùng bản hỗ trợ --session-info'
        : error.message
    });
  }
}
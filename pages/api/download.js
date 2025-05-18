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

    // Đường dẫn đến ipatool binary
    const ipatoolPath = path.join(process.cwd(), 'public', 'bin', 'ipatool');
    
    // Kiểm tra binary tồn tại và có quyền thực thi
    try {
      await fs.access(ipatoolPath, fs.constants.X_OK);
    } catch (err) {
      console.error('ipatool binary not found or not executable');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Kiểm tra version ipatool (debug)
    const versionCheck = await execFileAsync(ipatoolPath, ['--version']);
    console.log('ipatool version:', versionCheck.stdout);

    // Execute ipatool với cú pháp cho phiên bản 2.1.6
    const args = [
      'download',
      '--bundle-identifier',
      appId,
      '--email',
      appleId,
      '--password',
      password
    ];

    // Thêm 2FA code nếu có
    if (code) {
      args.push('--code', code);
    }

    // Thêm App Version ID nếu cần (kiểm tra docs ipatool 2.1.6)
    if (appVerId) {
      args.push('--app-version', appVerId);
    }

    console.log('Executing command:', ipatoolPath, args.join(' '));

    const { stdout, stderr } = await execFileAsync(
      ipatoolPath,
      args,
      { timeout: 60000 } // 60 seconds timeout
    );

    if (stderr && stderr.trim() !== '') {
      console.error('ipatool stderr:', stderr);
      if (stderr.includes('2FA')) {
        return res.status(401).json({ error: '2FA required' });
      }
      throw new Error(stderr);
    }

    console.log('ipatool stdout:', stdout);

    // Xử lý output (tùy thuộc vào định dạng output của ipatool 2.1.6)
    const downloadPath = stdout.trim().split('\n').find(line => line.endsWith('.ipa'));
    
    if (!downloadPath) {
      throw new Error('Failed to parse download path from output');
    }

    // Đọc và trả về file IPA
    const ipaContent = await fs.readFile(downloadPath);
    await fs.unlink(downloadPath); // Xóa file tạm

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Download error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to download IPA',
      details: error.stack
    });
  }
}
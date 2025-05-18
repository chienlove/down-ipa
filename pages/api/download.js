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
    
    // Kiểm tra binary tồn tại
    try {
      await fs.access(ipatoolPath, fs.constants.X_OK);
    } catch (err) {
      console.error('ipatool binary not found or not executable');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Tạo session info
    const sessionInfo = {
      appleId,
      password,
      appId,
      appVerId,
      code
    };

    // Set HOME environment variable
    process.env.HOME = '/tmp';

    // Execute ipatool
    const { stdout, stderr } = await execFileAsync(
      ipatoolPath,
      [
        'download',
        '--bundle-identifier',
        appId,
        '--session-info',
        JSON.stringify(sessionInfo)
      ],
      { timeout: 60000 }
    );

    if (stderr && stderr.trim() !== '') {
      console.error('ipatool stderr:', stderr);
      if (stderr.includes('2FA')) {
        return res.status(401).json({ error: '2FA required' });
      }
      throw new Error(stderr);
    }

    // Parse output
    let downloadResult;
    try {
      downloadResult = JSON.parse(stdout);
    } catch (err) {
      console.error('Failed to parse ipatool output:', stdout);
      throw new Error('Failed to parse download result');
    }

    if (!downloadResult.path) {
      throw new Error('Download failed: no path in result');
    }

    // Read and return the IPA file
    const ipaContent = await fs.readFile(downloadResult.path);
    await fs.unlink(downloadResult.path);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);
  } catch (error) {
    console.error('Download error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to download IPA'
    });
  }
}
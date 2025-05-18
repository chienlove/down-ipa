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

    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755);

    process.env.HOME = '/tmp';

    // ---------------------
    // Bước 1: Đăng nhập
    // ---------------------
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password
    ];
    if (code) loginArgs.push('--code', code);

    try {
      const { stdout: loginOut } = await execFileAsync(ipatoolPath, loginArgs, { timeout: 30000 });
      console.log('Login success:', loginOut);
    } catch (loginError) {
      const message = loginError.stderr?.toString() || loginError.message;
      console.error('Login error:', message);

      if (message.includes('two-factor authentication code')) {
        return res.status(401).json({
          error: '2FA required',
          message: 'Cần mã xác thực hai yếu tố (2FA)'
        });
      }

      return res.status(500).json({
        error: 'Login failed',
        details: message
      });
    }

    // ---------------------
    // Bước 2: Tải IPA
    // ---------------------
    const downloadArgs = [
      'download',
      '--bundle-identifier', appId,
      '--version', appVerId
    ];

    const { stdout } = await execFileAsync(ipatoolPath, downloadArgs, { timeout: 120000 });
    const downloadPath = stdout.trim().split('\n').pop();

    if (!downloadPath.endsWith('.ipa')) {
      throw new Error(`Invalid IPA path: ${downloadPath}`);
    }

    const ipaContent = await fs.readFile(downloadPath);
    await fs.unlink(downloadPath);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    return res.send(ipaContent);

  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({
      error: 'Download failed',
      details: error.message,
      solution: 'Kiểm tra ipatool version và thông tin tài khoản.'
    });
  }
}
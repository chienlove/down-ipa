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
    console.log('Request received:', { appleId, appId, hasCode: !!code });

    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755);

    process.env.HOME = '/tmp';

    // Bước 1: Đăng nhập
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
      const errorOutput = (loginError.stderr || loginError.stdout || loginError.message || '').toString();
      console.log('Raw login error:', loginError);
      console.error('Login error output:', errorOutput);

      if (errorOutput.includes('two-factor') || errorOutput.includes('2FA')) {
        return res.status(401).json({ 
          error: '2FA required',
          details: '2FA code needed'
        });
      }
      throw new Error(`Login failed: ${errorOutput}`);
    }

    // Bước 2: Tải IPA
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
    console.error('Full error:', error);
    return res.status(500).json({
      error: 'Download failed',
      details: error.message
    });
  }
}
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync, createReadStream } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);
const activeSessions = new Map();

// Session cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.lastActivity > 30 * 60 * 1000) { // 30 minutes inactivity
      activeSessions.delete(sessionId);
      console.log(`Cleaned expired session: ${sessionId}`);
    }
  }
}, 5 * 60 * 1000);

async function authenticateWithApple(appleId, password, twoFactorCode = null, sessionId = null) {
  const tempDir = path.join('/tmp', `ipa_auth_${sessionId || uuidv4()}`);
  await fs.mkdir(tempDir, { recursive: true });
  
  const args = [
    'auth', 'login',
    '--email', appleId,
    '--password', password,
    '--keychain-passphrase', ''
  ];

  if (twoFactorCode) {
    args.push('--auth-code', twoFactorCode);
  }

  try {
    const { stdout } = await execFileAsync('/usr/local/bin/ipatool', args, {
      env: {
        ...process.env,
        HOME: tempDir,
        TMPDIR: tempDir
      },
      timeout: 120000 // 2 minutes timeout
    });

    return { success: true, message: stdout };
  } catch (error) {
    const errorOutput = [error.stdout, error.stderr, error.message].join(' ').toLowerCase();
    return { 
      success: false, 
      requires2FA: /verification code|two-factor|2fa|security code|6-digit/.test(errorOutput),
      error: errorOutput.includes('invalid credentials') ? 'Invalid credentials' : 
            errorOutput.includes('account locked') ? 'Account locked' :
            'Authentication failed'
    };
  } finally {
    setTimeout(() => fs.rm(tempDir, { recursive: true, force: true }), 5000);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { appleId, password, appId, twoFactorCode, sessionId } = req.body;

  // Input validation
  if (!appleId || !password || !appId) {
    return res.status(400).json({ 
      error: 'MISSING_FIELDS', 
      message: 'Vui lòng nhập đầy đủ Apple ID, mật khẩu và Bundle ID' 
    });
  }

  // Handle 2FA verification
  if (twoFactorCode && sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) {
      return res.status(400).json({ 
        error: 'INVALID_SESSION', 
        message: 'Phiên làm việc đã hết hạn. Vui lòng thử lại' 
      });
    }

    const authResult = await authenticateWithApple(appleId, password, twoFactorCode, sessionId);
    
    if (!authResult.success) {
      session.attempts = (session.attempts || 0) + 1;
      
      if (session.attempts >= 3) {
        activeSessions.delete(sessionId);
        return res.status(403).json({ 
          error: 'TOO_MANY_ATTEMPTS', 
          message: 'Bạn đã nhập sai mã 2FA quá 3 lần. Vui lòng thử lại sau 30 phút' 
        });
      }

      return res.status(401).json({ 
        error: 'INVALID_2FA', 
        message: 'Mã xác thực không đúng. Vui lòng kiểm tra lại' 
      });
    }
  } 
  // Initial authentication
  else {
    const authResult = await authenticateWithApple(appleId, password);
    
    if (!authResult.success && authResult.requires2FA) {
      const newSessionId = uuidv4();
      activeSessions.set(newSessionId, { 
        appleId, 
        password, 
        appId,
        attempts: 0,
        lastActivity: Date.now() 
      });

      return res.status(200).json({ 
        requiresTwoFactor: true,
        sessionId: newSessionId,
        message: 'Vui lòng nhập mã xác thực 2 yếu tố (6 chữ số) đã gửi đến thiết bị của bạn'
      });
    }
    else if (!authResult.success) {
      return res.status(401).json({ 
        error: 'AUTH_FAILED', 
        message: authResult.error || 'Đăng nhập thất bại' 
      });
    }
  }

  // Proceed with download after successful auth
  const tempDir = path.join('/tmp', `ipa_dl_${uuidv4()}`);
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const ipaPath = path.join(tempDir, `${appId}.ipa`);
    
    await execFileAsync('/usr/local/bin/ipatool', [
      'download',
      '--bundle-identifier', appId,
      '--output', ipaPath,
      '--keychain-passphrase', ''
    ], { timeout: 300000 }); // 5 minutes timeout

    if (!existsSync(ipaPath)) {
      throw new Error('Không tạo được file IPA');
    }

    const stats = await fs.stat(ipaPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`);
    res.setHeader('Content-Length', stats.size);

    return createReadStream(ipaPath).pipe(res);
  } catch (error) {
    console.error('Download failed:', error);
    return res.status(500).json({ 
      error: 'DOWNLOAD_FAILED', 
      message: 'Không thể tải ứng dụng. Vui lòng kiểm tra Bundle ID và thử lại' 
    });
  } finally {
    setTimeout(() => fs.rm(tempDir, { recursive: true, force: true }), 5000);
  }
}
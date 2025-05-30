import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);
const sessions = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let tempDir = null;
  let downloadedFile = null;

  try {
    const { appleId, password, appId, appVerId, twoFactorCode, sessionId } = req.body;

    // Validate required fields
    if (!appleId || !password || !appId) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'Apple ID, mật khẩu và App ID là bắt buộc'
      });
    }

    // Create temporary directory for this session
    const tempSessionId = sessionId || uuidv4();
    tempDir = path.join('/tmp', `ipa_${tempSessionId}`);
    
    try {
      await fs.mkdir(tempDir, { recursive: true });
    } catch (err) {
      console.warn('Could not create temp directory:', err.message);
      tempDir = '/tmp';
    }

    const ipatoolPath = '/usr/local/bin/ipatool';
    
    // Check if ipatool exists
    if (!existsSync(ipatoolPath)) {
      return res.status(500).json({
        error: 'TOOL_NOT_FOUND',
        message: 'ipatool không tìm thấy'
      });
    }

    // Set environment variables
    const env = {
      ...process.env,
      HOME: tempDir,
      TMPDIR: tempDir
    };

    let existingSession = sessions.get(tempSessionId);

    try {
      // If we have a session and 2FA code, try to complete authentication
      if (existingSession && twoFactorCode) {
        console.log('Completing 2FA authentication...');
        
        try {
          const { stdout: authResult } = await execFileAsync(
            ipatoolPath,
            ['auth', '--keychain-passphrase', '', '--non-interactive'],
            { 
              env,
              cwd: tempDir,
              timeout: 30000,
              input: twoFactorCode + '\n'
            }
          );
          
          console.log('2FA completed:', authResult);
          sessions.delete(tempSessionId);
          existingSession = null;
        } catch (authError) {
          console.error('2FA error:', authError.message);
          return res.status(400).json({
            error: 'TWO_FACTOR_FAILED',
            message: 'Mã 2FA không đúng hoặc đã hết hạn'
          });
        }
      }

      // If no existing session, authenticate
      if (!existingSession) {
        console.log('Starting authentication...');
        
        try {
          const { stdout: authResult } = await execFileAsync(
            ipatoolPath,
            [
              'auth',
              'login',
              '--email', appleId,
              '--password', password,
              '--keychain-passphrase', '',
              '--non-interactive'
            ],
            { 
              env,
              cwd: tempDir,
              timeout: 60000
            }
          );
          
          console.log('Authentication successful:', authResult);
        } catch (authError) {
          console.error('Auth error:', authError);
          
          if (authError.message.includes('verification code') || 
              authError.message.includes('two-factor') ||
              authError.stdout?.includes('verification code')) {
            
            sessions.set(tempSessionId, {
              appleId,
              password,
              appId,
              appVerId,
              timestamp: Date.now()
            });
            
            return res.status(202).json({
              requiresTwoFactor: true,
              sessionId: tempSessionId,
              message: 'Cần nhập mã xác thực 2 yếu tố'
            });
          }
          
          return res.status(401).json({
            error: 'AUTH_FAILED',
            message: 'Đăng nhập thất bại. Vui lòng kiểm tra Apple ID và mật khẩu.'
          });
        }
      }

      // Now download the app
      console.log(`Starting download for app: ${appId}`);
      
      const downloadArgs = [
        'download',
        '--bundle-identifier', appId,
        '--output-dir', tempDir
      ];

      // Add app version if specified
      if (appVerId) {
        downloadArgs.push('--app-version-id', appVerId);
      }

      const { stdout: downloadResult } = await execFileAsync(
        ipatoolPath,
        downloadArgs,
        { 
          env,
          cwd: tempDir,
          timeout: 300000 // 5 minutes timeout for download
        }
      );
      
      console.log('Download completed:', downloadResult);

      // Find the downloaded IPA file
      const files = await fs.readdir(tempDir);
      const ipaFile = files.find(file => file.endsWith('.ipa'));
      
      if (!ipaFile) {
        return res.status(500).json({
          error: 'FILE_NOT_FOUND',
          message: 'Không tìm thấy file IPA sau khi tải xuống'
        });
      }

      downloadedFile = path.join(tempDir, ipaFile);
      const fileStats = await fs.stat(downloadedFile);
      const fileBuffer = await fs.readFile(downloadedFile);

      // Set appropriate headers for file download
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${ipaFile}"`);
      res.setHeader('Content-Length', fileStats.size);
      
      // Send the file
      res.send(fileBuffer);

    } catch (error) {
      console.error('Download process error:', error);
      
      if (error.code === 'TIMEOUT') {
        return res.status(408).json({
          error: 'TIMEOUT',
          message: 'Quá trình tải xuống bị timeout'
        });
      }
      
      return res.status(500).json({
        error: 'DOWNLOAD_FAILED',
        message: error.message || 'Tải xuống thất bại'
      });
    }

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Lỗi server nội bộ'
    });
  } finally {
    // Cleanup: remove temporary files
    if (tempDir && tempDir !== '/tmp') {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Cleanup warning:', cleanupError.message);
      }
    }
  }
}

// Cleanup old sessions every hour
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.timestamp > oneHour) {
      sessions.delete(sessionId);
    }
  }
}, oneHour);
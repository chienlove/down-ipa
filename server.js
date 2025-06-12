import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fsPromises } from 'fs';
import fetch from 'node-fetch';
import { Store } from './src/client.js';
import { SignatureTransform } from './src/Signature.js';
import { v4 as uuidv4 } from 'uuid';
import { Agent } from 'https';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Transform } from 'stream';
import plist from 'plist';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 5004;

// R2 Configuration
const R2_PUBLIC_BASE = 'https://file.storeios.net';
const R2_ENDPOINT = 'https://b9b33e1228ae77e510897cc002c1735c.r2.cloudflarestorage.com';
const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  },
  forcePathStyle: true
});

// R2 Helper Functions
async function uploadToR2({ key, stream, contentType, contentLength }) {
  try {
    const command = new PutObjectCommand({
      Bucket: 'file',
      Key: key,
      Body: stream,
      ContentType: contentType,
      ContentLength: contentLength
    });
    return await r2Client.send(command);
  } catch (error) {
    console.error('R2 upload error:', error);
    throw error;
  }
}

async function deleteFromR2(key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: 'file',
      Key: key
    });
    await r2Client.send(command);
    console.log(`Successfully deleted ${key} from R2`);
  } catch (error) {
    console.error('R2 delete error:', error);
    throw error;
  }
}

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/.well-known/acme-challenge', express.static(path.join(__dirname, '.well-known', 'acme-challenge')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    version: '1.0.1',
    timestamp: new Date().toISOString()
  });
});

// R2 Connection Test Endpoint
app.get('/check-r2', async (req, res) => {
  try {
    const testKey = `test-${Date.now()}.txt`;
    const command = new PutObjectCommand({
      Bucket: 'file',
      Key: testKey,
      Body: 'test content',
      ContentType: 'text/plain'
    });
    
    await r2Client.send(command);
    await deleteFromR2(testKey);
    
    res.json({ success: true, message: 'R2 connection is working' });
  } catch (error) {
    console.error('R2 test error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: 'Failed to connect to R2' 
    });
  }
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// IPATool với stream trực tiếp lên R2
class IPATool {
  async downipa({ APPLE_ID, PASSWORD, CODE, APPID, appVerId } = {}) {
    try {
      console.log('Authenticating with Apple ID...');
      const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

      if (user._state !== 'success') {
        if (user.failureType?.toLowerCase().includes('mfa')) {
          return { require2FA: true, message: user.customerMessage || '2FA verification required' };
        }
        throw new Error(user.customerMessage || 'Authentication failed');
      }

      console.log('Fetching app info...');
      const app = await Store.download(APPID, appVerId, user);
      const songList0 = app?.songList?.[0];

      if (!app || app._state !== 'success' || !songList0 || !songList0.metadata) {
        if (app?.failureType?.toLowerCase().includes('mfa')) {
          return { require2FA: true, message: app.customerMessage || '2FA verification required' };
        }
        throw new Error(app?.customerMessage || 'Failed to get app information');
      }

      const appInfo = {
        name: songList0.metadata.bundleDisplayName,
        artist: songList0.metadata.artistName,
        version: songList0.metadata.bundleShortVersionString,
        bundleId: songList0.metadata.softwareVersionBundleId,
        releaseDate: songList0.metadata.releaseDate
      };

      // Tạo key ngẫu nhiên cho R2
      const randomId = uuidv4().substring(0, 8);
      const ipaKey = `temp-ipas/${randomId}_${appInfo.name.replace(/[^a-z0-9]/gi, '_')}.ipa`;
      const plistKey = `temp-manifests/${randomId}.plist`;

      // Tải IPA từ App Store
      console.log('Downloading from App Store...');
      const ipaResponse = await fetch(songList0.URL, { 
        agent: new Agent({ rejectUnauthorized: false }) 
      });
      
      if (!ipaResponse.ok) throw new Error(`Failed to download IPA: ${ipaResponse.statusText}`);

      const contentLength = Number(ipaResponse.headers.get('content-length'));
      if (!contentLength || contentLength > 2 * 1024 * 1024 * 1024) {
        throw new Error('Invalid file size or file too large (>2GB)');
      }

      // Tạo transform stream để xử lý signature
      const signatureTransform = new SignatureTransform(songList0, APPLE_ID);

      // Pipe qua transform stream
      ipaResponse.body.pipe(signatureTransform);

      // Upload stream đã xử lý lên R2
      console.log('Uploading processed IPA to R2...');
      await uploadToR2({
        key: ipaKey,
        stream: signatureTransform,
        contentType: 'application/octet-stream',
        contentLength: contentLength // Sử dụng content-length gốc (xấp xỉ)
      });

      // Tạo plist file
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${R2_PUBLIC_BASE}/${ipaKey}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${appInfo.bundleId}</string>
        <key>bundle-version</key>
        <string>${appInfo.version}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${appInfo.name}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;

      // Upload plist lên R2
      console.log('Uploading plist to R2...');
      await uploadToR2({
        key: plistKey,
        stream: Buffer.from(plistContent),
        contentType: 'application/xml',
        contentLength: Buffer.byteLength(plistContent)
      });

      // Lên lịch xóa file sau 5 phút
      setTimeout(async () => {
        try {
          await deleteFromR2(ipaKey);
          await deleteFromR2(plistKey);
          console.log(`Cleaned up temporary files: ${ipaKey}, ${plistKey}`);
        } catch (err) {
          console.error('Cleanup error:', err);
        }
      }, 5 * 60 * 1000);

      return {
        appInfo,
        downloadUrl: `${R2_PUBLIC_BASE}/${ipaKey}`,
        installUrl: `itms-services://?action=download-manifest&url=${encodeURIComponent(`${R2_PUBLIC_BASE}/${plistKey}`)}`,
        r2UploadSuccess: true
      };
    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }
}

const ipaTool = new IPATool();

// Authentication routes (giữ nguyên)
app.post('/auth', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD } = req.body;
    const user = await Store.authenticate(APPLE_ID, PASSWORD);

    const debugLog = {
      _state: user._state,
      failureType: user.failureType,
      customerMessage: user.customerMessage,
      authOptions: user.authOptions,
      dsid: user.dsPersonId
    };

    const needs2FA = (
      user.customerMessage?.toLowerCase().includes('mã xác minh') ||
      user.customerMessage?.toLowerCase().includes('two-factor') ||
      user.customerMessage?.toLowerCase().includes('mfa') ||
      user.customerMessage?.toLowerCase().includes('code') ||
      user.customerMessage?.includes('Configurator_message')
    );

    if (needs2FA || user.failureType?.toLowerCase().includes('mfa')) {
      return res.json({
        require2FA: true,
        message: user.customerMessage || 'Tài khoản cần xác minh 2FA',
        dsid: user.dsPersonId,
        debug: debugLog
      });
    }

    if (user._state === 'success') {
      return res.json({
        success: true,
        dsid: user.dsPersonId,
        debug: debugLog
      });
    }

    throw new Error(user.customerMessage || 'Đăng nhập thất bại');
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Lỗi xác thực Apple ID'
    });
  }
});

app.post('/verify', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE } = req.body;
    
    if (!APPLE_ID || !PASSWORD || !CODE) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields are required' 
      });
    }

    console.log(`Verifying 2FA for: ${APPLE_ID}`);
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

    if (user._state !== 'success') {
      throw new Error(user.customerMessage || 'Verification failed');
    }

    res.json({ 
      success: true,
      dsid: user.dsPersonId
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Verification error' 
    });
  }
});

// Download route
app.post('/download', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE, APPID, appVerId } = req.body;

    if (!APPLE_ID || !PASSWORD || !APPID) {
      return res.status(400).json({
        success: false,
        error: 'Required fields are missing'
      });
    }

    const result = await ipaTool.downipa({
      APPLE_ID,
      PASSWORD,
      CODE,
      APPID,
      appVerId
    });

    if (result.require2FA) {
      return res.json({
        success: false,
        require2FA: true,
        message: result.message
      });
    }

    res.json({
      success: true,
      downloadUrl: result.downloadUrl,
      appInfo: result.appInfo,
      installUrl: result.installUrl,
      r2UploadSuccess: result.r2UploadSuccess
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Download failed'
    });
  }
});

// Error handlers
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`R2 test endpoint: http://localhost:${port}/check-r2`);
});

const shutdown = () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server stopped');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
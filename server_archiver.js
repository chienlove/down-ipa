import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs, { promises as fsPromises, createWriteStream, createReadStream } from 'fs';
import fetch from 'node-fetch';
import { Store } from './src/client.js';
import { SignatureClient } from './src/Signature.js';
import { v4 as uuidv4 } from 'uuid';
import { Agent } from 'https';
import archiver from 'archiver';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

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
async function uploadToR2({ key, filePath, contentType }) {
  try {
    console.log(`Preparing to upload to R2: ${key}`);
    const fileContent = await fsPromises.readFile(filePath);
    console.log(`File read successfully, size: ${fileContent.length} bytes`);

    const command = new PutObjectCommand({
      Bucket: 'file',
      Key: key,
      Body: fileContent,
      ContentType: contentType
    });

    console.log('Sending upload command to R2...');
    const result = await r2Client.send(command);
    console.log('Upload successful:', result);
    return result;
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

// Constants
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CONCURRENT_DOWNLOADS = 10;
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;
const REQUEST_TIMEOUT = 15000; // 15 seconds

// Helper functions
function generateRandomString(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

async function downloadChunk({ url, start, end, output }) {
  const headers = { Range: `bytes=${start}-${end}` };
  const agent = new Agent({ rejectUnauthorized: false });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      
      const response = await fetch(url, { 
        headers,
        agent,
        signal: controller.signal 
      });
      
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const fileStream = createWriteStream(output, { flags: 'a' });
      await new Promise((resolve, reject) => {
        response.body.pipe(fileStream);
        response.body.on('error', reject);
        fileStream.on('finish', resolve);
      });
      return;
    } catch (error) {
      if (attempt === MAX_RETRIES - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

async function clearCache(cacheDir) {
  try {
    const files = await fsPromises.readdir(cacheDir);
    await Promise.all(files.map(file => fsPromises.unlink(path.join(cacheDir, file))));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Cache clearance error: ${error.message}`);
    }
  }
}

class IPATool {
  async downipa({ path: downloadPath, APPLE_ID, PASSWORD, CODE, APPID, appVerId } = {}) {
    downloadPath = downloadPath || '.';
    console.log(`Starting download for app: ${APPID}`);

    try {
      console.log('Authenticating with Apple ID...');
      const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

      if (user._state !== 'success') {
        if (user.failureType?.toLowerCase().includes('mfa')) {
          return {
            require2FA: true,
            message: user.customerMessage || '2FA verification required'
          };
        }
        throw new Error(user.customerMessage || 'Authentication failed');
      }

      console.log('Fetching app info...');
      const app = await Store.download(APPID, appVerId, user);
      const songList0 = app?.songList?.[0];

      if (!app || app._state !== 'success' || !songList0 || !songList0.metadata) {
        if (app?.failureType?.toLowerCase().includes('mfa')) {
          return {
            require2FA: true,
            message: app.customerMessage || '2FA verification required'
          };
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

      await fsPromises.mkdir(downloadPath, { recursive: true });
      const uniqueString = uuidv4();
      const outputFileName = `${appInfo.name.replace(/[^a-z0-9]/gi, '_')}_${appInfo.version}_${uniqueString}.ipa`;
      const outputFilePath = path.join(downloadPath, outputFileName);
      const cacheDir = path.join(downloadPath, 'cache');

      await fsPromises.mkdir(cacheDir, { recursive: true });
      await clearCache(cacheDir);

      console.log('Downloading IPA file...');
      const resp = await fetch(songList0.URL, { 
        agent: new Agent({ rejectUnauthorized: false }) 
      });
      
      if (!resp.ok) throw new Error(`Failed to download IPA: ${resp.statusText}`);

      const fileSize = Number(resp.headers.get('content-length'));
      const numChunks = Math.ceil(fileSize / CHUNK_SIZE);

      console.log(`Downloading ${(fileSize / 1024 / 1024).toFixed(2)}MB in ${numChunks} chunks...`);

      const downloadQueue = Array.from({ length: numChunks }, (_, i) => {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
        const tempOutput = path.join(cacheDir, `part${i}`);
        return () => downloadChunk({ 
          url: songList0.URL, 
          start, 
          end, 
          output: tempOutput 
        });
      });

      for (let i = 0; i < downloadQueue.length; i += MAX_CONCURRENT_DOWNLOADS) {
        await Promise.all(downloadQueue.slice(i, i + MAX_CONCURRENT_DOWNLOADS).map(fn => fn()));
      }

      console.log('Merging chunks...');
      const finalFile = createWriteStream(outputFilePath);
      for (let i = 0; i < numChunks; i++) {
        const tempOutput = path.join(cacheDir, `part${i}`);
        const tempStream = createReadStream(tempOutput);
        await new Promise(resolve => {
          tempStream.pipe(finalFile, { end: false });
          tempStream.on('end', () => {
            fsPromises.unlink(tempOutput).then(resolve);
          });
        });
      }
      finalFile.end();

      console.log('Signing IPA...');
      const sigClient = new SignatureClient(songList0, APPLE_ID);
await sigClient.loadFile(outputFilePath);
await sigClient.appendMetadata().appendSignature();

const signedDir = path.join(downloadPath, 'signed');
await sigClient.extractToDirectory(signedDir);
console.log('🔧 Using archiver to zip signed IPA...');

// Nén lại IPA bằng stream để giảm RAM
await new Promise((resolve, reject) => {
  const output = createWriteStream(outputFilePath); // ghi đè lên file cũ
  const archive = archiver('zip', { zlib: { level: 9 } });

  output.on('close', () => {
    console.log(`✅ Archiver finished zipping. Final size: ${archive.pointer()} bytes`);
    resolve();
  });

  archive.on('error', (err) => {
    console.error('❌ Archiver error:', err);
    reject(err);
  });

  archive.pipe(output);
  archive.directory(signedDir, false);
  archive.finalize();
});

      // R2 Upload
      let ipaUrl = `/files/${path.basename(downloadPath)}/${outputFileName}`;
      let installUrl = null;
      let r2Success = false;

      try {
        const ipaKey = `ipas/${outputFileName}`;
        await uploadToR2({
          key: ipaKey,
          filePath: outputFilePath,
          contentType: 'application/octet-stream'
        });

        const plistName = outputFileName.replace(/\.ipa$/, '.plist');
        const plistKey = `manifests/${plistName}`;
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

        const plistPath = path.join(downloadPath, plistName);
        await fsPromises.writeFile(plistPath, plistContent, 'utf8');
        await uploadToR2({
          key: plistKey,
          filePath: plistPath,
          contentType: 'application/xml'
        });

        await fsPromises.unlink(plistPath);
console.log(`Deleted local plist file: ${plistPath}`);

        ipaUrl = `${R2_PUBLIC_BASE}/${ipaKey}`;
installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(`${R2_PUBLIC_BASE}/${plistKey}`)}`;
        r2Success = true;

        setTimeout(async () => {
          try {
            await deleteFromR2(ipaKey);
            await deleteFromR2(plistKey);
          } catch (err) {
            console.error('R2 cleanup error:', err);
          }
        }, 5 * 60 * 1000);

      } catch (error) {
        console.error('R2 upload failed (using local file):', error);
      }

      await fsPromises.rm(cacheDir, { recursive: true, force: true });
      console.log('Download completed successfully!');

      return {
        appInfo,
        fileName: outputFileName,
        filePath: outputFilePath,
        downloadUrl: ipaUrl,
        installUrl: installUrl,
        r2UploadSuccess: r2Success
      };
    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }
}

const ipaTool = new IPATool();

// Authentication routes
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

app.post('/download', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE, APPID, appVerId } = req.body;

    if (!APPLE_ID || !PASSWORD || !APPID) {
      return res.status(400).json({
        success: false,
        error: 'Required fields are missing'
      });
    }

    const uniqueDownloadPath = path.join(__dirname, 'app', generateRandomString());
    console.log(`Download request for app: ${APPID}`);

    const result = await ipaTool.downipa({
      path: uniqueDownloadPath,
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

    // ✅ Xoá file IPA local
    try {
      await fsPromises.unlink(result.filePath);
      await fsPromises.rm(path.dirname(result.filePath), { recursive: true, force: true });
      await fsPromises.rm(path.join(path.dirname(result.filePath), 'signed'), { recursive: true, force: true });
      console.log(`Cleaned up local file and folder: ${result.filePath}`);
    } catch (err) {
      console.error('Cleanup IPA error:', err.message);
    }

    // ✅ Xoá file .plist nếu có
    if (result.plistPath) {
      try {
        await fsPromises.unlink(result.plistPath);
        console.log(`Deleted local plist file: ${result.plistPath}`);
      } catch (err) {
        console.error('Cleanup plist error:', err.message);
      }
    }

    // ✅ Trả kết quả
    res.json({
      success: true,
      downloadUrl: result.downloadUrl,
      fileName: result.fileName,
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

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

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
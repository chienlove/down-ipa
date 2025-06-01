import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs, { promises as fsPromises, createWriteStream, createReadStream } from 'fs';
import fetch from 'node-fetch';
import { Store } from './src/client.js';
import { SignatureClient } from './src/Signature.js';
import { v4 as uuidv4 } from 'uuid';
import { Agent } from 'https';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 5004;

// Enhanced middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/.well-known/acme-challenge', express.static(path.join(__dirname, '.well-known', 'acme-challenge')));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    version: '1.0.1',
    timestamp: new Date().toISOString()
  });
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
  console.log(`Downloading chunk ${start}-${end} to ${output}`);
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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const fileStream = createWriteStream(output, { flags: 'a' });
      await new Promise((resolve, reject) => {
        response.body.pipe(fileStream);
        response.body.on('error', reject);
        fileStream.on('finish', resolve);
      });
      return;
    } catch (error) {
      console.error(`Chunk download attempt ${attempt + 1} failed:`, error);
      if (attempt === MAX_RETRIES - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
}

async function clearCache(cacheDir) {
  try {
    console.log(`Clearing cache directory: ${cacheDir}`);
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
      console.log('Apple authentication response:', JSON.stringify(user, null, 2));

      if (user._state !== 'success') {
        if (user.failureType?.toLowerCase().includes('mfa')) {
          console.log('2FA required during download');
          return {
            require2FA: true,
            message: user.customerMessage || '2FA verification required'
          };
        }
        throw new Error(user.customerMessage || 'Authentication failed');
      }

      console.log('Fetching app info...');
      const app = await Store.download(APPID, appVerId, user);
      console.log('App info response:', JSON.stringify(app, null, 2));
      const songList0 = app?.songList?.[0];

      if (!app || app._state !== 'success' || !songList0 || !songList0.metadata) {
        if (app?.failureType?.toLowerCase().includes('mfa')) {
          console.log('2FA required during app info fetch');
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

      // Download chunks in parallel
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
      await sigClient.write();

      await fsPromises.rm(cacheDir, { recursive: true, force: true });
      console.log('Download completed successfully!');

      return {
        appInfo,
        fileName: outputFileName,
        filePath: outputFilePath
      };
    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }
}

const ipaTool = new IPATool();

// Authentication endpoint
app.post('/auth', async (req, res) => {
  try {
    console.log('Auth request received:', req.body);
    const { APPLE_ID, PASSWORD } = req.body;
    
    if (!APPLE_ID || !PASSWORD) {
      console.log('Missing credentials');
      return res.status(400).json({ 
        success: false,
        error: 'Apple ID và mật khẩu là bắt buộc'
      });
    }

    console.log(`Authenticating Apple ID: ${APPLE_ID}`);
    const user = await Store.authenticate(APPLE_ID, PASSWORD);
    console.log('Apple authentication response:', JSON.stringify(user, null, 2));

    // Kiểm tra trạng thái đăng nhập
    if (user._state !== 'success') {
      console.log('Authentication failed');
      
      // Kiểm tra có cần 2FA không
      const needs2FA = (
        user.customerMessage?.toLowerCase().includes('mã xác minh') ||
        user.customerMessage?.toLowerCase().includes('two-factor') ||
        user.customerMessage?.toLowerCase().includes('mfa') ||
        user.customerMessage?.toLowerCase().includes('code') ||
        user.failureType?.toLowerCase().includes('mfa')
      );

      if (needs2FA) {
        console.log('2FA required for account');
        return res.json({
          require2FA: true,
          success: false, // Thêm trường này để client biết đây không phải là thành công
          message: user.customerMessage || 'Tài khoản cần xác minh 2FA',
          dsid: user.dsPersonId
        });
      }

      // Nếu không phải 2FA thì là lỗi đăng nhập
      return res.status(401).json({
        success: false,
        error: user.customerMessage || 'Sai Apple ID hoặc mật khẩu'
      });
    }

    console.log('Authentication successful');
    res.json({
      success: true,
      dsid: user.dsPersonId
    });

  } catch (error) {
    console.error('Auth endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Lỗi xác thực Apple ID'
    });
  }
});

// 2FA Verification endpoint
app.post('/verify', async (req, res) => {
  try {
    console.log('Verify request received:', req.body);
    const { APPLE_ID, PASSWORD, CODE } = req.body;
    
    if (!APPLE_ID || !PASSWORD || !CODE) {
      console.log('Missing verification fields');
      return res.status(400).json({ 
        success: false, 
        error: 'All fields are required' 
      });
    }

    console.log(`Verifying 2FA for: ${APPLE_ID}`);
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);
    console.log('2FA verification response:', JSON.stringify(user, null, 2));

    if (user._state !== 'success') {
      console.log('2FA verification failed');
      throw new Error(user.customerMessage || 'Verification failed');
    }

    console.log('2FA verification successful');
    res.json({ 
      success: true,
      dsid: user.dsPersonId
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Verification error',
      debug: {
        rawError: error.toString()
      }
    });
  }
});

// Download endpoint
app.post('/download', async (req, res) => {
  try {
    console.log('Download request received:', req.body);
    const { APPLE_ID, PASSWORD, CODE, APPID, appVerId } = req.body;
    
    if (!APPLE_ID || !PASSWORD || !APPID) {
      console.log('Missing required download fields');
      return res.status(400).json({ 
        success: false, 
        error: 'Required fields are missing' 
      });
    }

    const uniqueDownloadPath = path.join(__dirname, 'app', generateRandomString());
    console.log(`Download request for app: ${APPID} to path: ${uniqueDownloadPath}`);

    const result = await ipaTool.downipa({
      path: uniqueDownloadPath,
      APPLE_ID,
      PASSWORD,
      CODE,
      APPID,
      appVerId
    });

    if (result.require2FA) {
      console.log('2FA required during download process');
      return res.json({
        success: false,
        require2FA: true,
        message: result.message
      });
    }

    // Schedule cleanup after 30 minutes
    setTimeout(async () => {
      try {
        console.log(`Cleaning up: ${result.filePath}`);
        await fsPromises.unlink(result.filePath);
        await fsPromises.rm(uniqueDownloadPath, { recursive: true, force: true });
      } catch (err) {
        console.error('Cleanup error:', err.message);
      }
    }, 30 * 60 * 1000);

    console.log('Download completed, returning result');
    res.json({
      success: true,
      downloadUrl: `/files/${path.basename(uniqueDownloadPath)}/${result.fileName}`,
      fileName: result.fileName,
      appInfo: result.appInfo
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Download failed',
      debug: {
        rawError: error.toString(),
        stack: error.stack
      }
    });
  }
});

// Static files
app.use('/files', express.static(path.join(__dirname, 'app')));

// Error handling
app.use((req, res) => {
  console.error(`404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Not Found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    debug: {
      message: err.message,
      stack: err.stack
    }
  });
});

// Start server
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
});

// Shutdown handler
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
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs, { promises as fsPromises, createWriteStream, createReadStream } from 'fs';
import fetch from 'node-fetch';
import { Store } from './src/client.js';
import { SignatureClient } from './src/Signature.js';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 5004;

// Cấu hình middleware
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/.well-known/acme-challenge', express.static(path.join(__dirname, '.well-known', 'acme-challenge')));

// Các hằng số cấu hình
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CONCURRENT_DOWNLOADS = 5;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;
const DOWNLOAD_TIMEOUT = 30000; // 30 seconds
const FILE_CLEANUP_DELAY = 30 * 60 * 1000; // 30 minutes

// Helper functions
function generateRandomString(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

async function downloadChunk({ url, start, end, output, attempt = 1 }) {
  const headers = { Range: `bytes=${start}-${end}` };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

  try {
    const response = await fetch(url, { 
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const fileStream = createWriteStream(output, { flags: 'a' });
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on('error', reject);
      fileStream.on('finish', resolve);
    });

    return true;
  } catch (error) {
    if (attempt >= MAX_RETRIES) {
      throw new Error(`Failed after ${MAX_RETRIES} attempts: ${error.message}`);
    }
    
    console.warn(`Attempt ${attempt} failed, retrying in ${RETRY_DELAY}ms...`);
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    return downloadChunk({ url, start, end, output, attempt: attempt + 1 });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function clearCache(cacheDir) {
  try {
    const files = await fsPromises.readdir(cacheDir);
    await Promise.all(files.map(file => 
      fsPromises.unlink(path.join(cacheDir, file)).catch(() => {})
    ));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Cache clearance error: ${error.message}`);
    }
  }
}

class IPATool {
  constructor() {
    this.activeDownloads = new Set();
  }

  async validateCredentials(APPLE_ID, PASSWORD) {
    if (!APPLE_ID || !PASSWORD) {
      throw new Error('Apple ID và mật khẩu là bắt buộc');
    }
    
    if (PASSWORD.length < 8) {
      throw new Error('Mật khẩu phải có ít nhất 8 ký tự');
    }
  }

  async validateAppID(APPID) {
    if (!APPID) {
      throw new Error('App ID là bắt buộc');
    }
    
    if (typeof APPID !== 'string' || !/^\d+$/.test(APPID)) {
      throw new Error('App ID phải là chuỗi số');
    }
  }

  async downipa({ path: downloadPath, APPLE_ID, PASSWORD, CODE, APPID, appVerId } = {}) {
    try {
      // Validate input
      await this.validateCredentials(APPLE_ID, PASSWORD);
      await this.validateAppID(APPID);

      downloadPath = downloadPath || '.';
      const downloadId = uuidv4();
      this.activeDownloads.add(downloadId);

      console.log(`[${downloadId}] 🔑 Authenticating with Apple ID...`);
      let user;
      try {
        user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);
        console.log(`[${downloadId}] Auth response:`, JSON.stringify({
          state: user._state,
          account: user.accountInfo?.appleId,
          failureType: user.failureType
        }, null, 2));
      } catch (authError) {
        console.error(`[${downloadId}] Authentication error:`, authError);
        throw new Error(`Lỗi xác thực: ${authError.message}`);
      }

      if (user._state !== 'success') {
        if (user.failureType?.toLowerCase().includes('mfa')) {
          return {
            require2FA: true,
            message: user.customerMessage || '🔐 Apple yêu cầu mã xác minh 2FA. Vui lòng nhập mã để tiếp tục.'
          };
        }
        throw new Error(user.customerMessage || `❌ Đăng nhập thất bại. Chi tiết: ${JSON.stringify({
          state: user._state,
          failureType: user.failureType
        })}`);
      }

      console.log(`[${downloadId}] 📦 Fetching app info for ${APPID}...`);
      let app;
      try {
        app = await Store.download(APPID, appVerId, user);
        console.log(`[${downloadId}] App info response:`, JSON.stringify({
          state: app._state,
          bundleId: app.songList?.[0]?.metadata?.softwareVersionBundleId,
          failureType: app.failureType
        }, null, 2));
      } catch (appError) {
        console.error(`[${downloadId}] App info error:`, appError);
        throw new Error(`Lỗi khi lấy thông tin ứng dụng: ${appError.message}`);
      }

      const songList0 = app?.songList?.[0];

      if (!app || app._state !== 'success' || !songList0 || !songList0.metadata) {
        console.error(`[${downloadId}] Invalid app response:`, app);
        if (app?.failureType?.toLowerCase().includes('mfa')) {
          return {
            require2FA: true,
            message: app.customerMessage || '🔐 Apple yêu cầu mã xác minh 2FA. Vui lòng nhập mã để tiếp tục.'
          };
        }
        if (app?.customerMessage?.toLowerCase().includes('verification')) {
          throw new Error('❌ Mã xác minh 2FA không hợp lệ hoặc đã hết hạn.');
        }
        throw new Error(app?.customerMessage || `❌ Không thể tải ứng dụng. Chi tiết: ${JSON.stringify({
          state: app._state,
          failureType: app.failureType
        })}`);
      }

      const appInfo = {
        name: songList0.metadata.bundleDisplayName,
        artist: songList0.metadata.artistName,
        version: songList0.metadata.bundleShortVersionString,
        bundleId: songList0.metadata.softwareVersionBundleId,
        releaseDate: songList0.metadata.releaseDate
      };

      await fsPromises.mkdir(downloadPath, { recursive: true });
      const safeAppName = appInfo.name.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const outputFileName = `${safeAppName}_v${appInfo.version}_${uuidv4().slice(0, 8)}.ipa`;
      const outputFilePath = path.join(downloadPath, outputFileName);
      const cacheDir = path.join(downloadPath, 'cache_' + uuidv4().slice(0, 8));

      await fsPromises.mkdir(cacheDir, { recursive: true });
      await clearCache(cacheDir);

      console.log(`[${downloadId}] 🌐 Starting download from: ${songList0.URL}`);
      const resp = await fetch(songList0.URL, { method: 'HEAD' });
      if (!resp.ok) throw new Error(`❌ Không thể tải IPA: ${resp.statusText}`);

      const fileSize = Number(resp.headers.get('content-length'));
      if (!fileSize || fileSize <= 0) {
        throw new Error('❌ Kích thước file không hợp lệ');
      }

      const numChunks = Math.ceil(fileSize / CHUNK_SIZE);
      console.log(`[${downloadId}] 📥 Downloading ${(fileSize / 1024 / 1024).toFixed(2)}MB in ${numChunks} chunks...`);

      const downloadQueue = Array.from({ length: numChunks }, (_, i) => {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
        const tempOutput = path.join(cacheDir, `part_${i}`);
        return () => downloadChunk({ 
          url: songList0.URL, 
          start, 
          end, 
          output: tempOutput 
        });
      });

      // Download chunks in batches
      for (let i = 0; i < downloadQueue.length; i += MAX_CONCURRENT_DOWNLOADS) {
        const batch = downloadQueue.slice(i, i + MAX_CONCURRENT_DOWNLOADS);
        await Promise.all(batch.map(fn => fn()));
        console.log(`[${downloadId}] ✔️ Downloaded chunks ${i}-${Math.min(i + MAX_CONCURRENT_DOWNLOADS - 1, numChunks - 1)}/${numChunks - 1}`);
      }

      console.log(`[${downloadId}] 🔗 Merging ${numChunks} chunks...`);
      const finalFile = createWriteStream(outputFilePath);
      for (let i = 0; i < numChunks; i++) {
        const tempOutput = path.join(cacheDir, `part_${i}`);
        const tempStream = createReadStream(tempOutput);
        await new Promise(resolve => {
          tempStream.pipe(finalFile, { end: false });
          tempStream.on('end', () => {
            fsPromises.unlink(tempOutput).catch(() => {}).finally(resolve);
          });
        });
      }
      finalFile.end();

      console.log(`[${downloadId}] 🖊️ Signing IPA...`);
      const sigClient = new SignatureClient(songList0, APPLE_ID);
      await sigClient.loadFile(outputFilePath);
      await sigClient.appendMetadata().appendSignature();
      await sigClient.write();

      console.log(`[${downloadId}] 🧹 Cleaning up cache...`);
      await fsPromises.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
      
      console.log(`[${downloadId}] ✅ Download completed successfully!`);
      this.activeDownloads.delete(downloadId);

      return {
        success: true,
        appInfo,
        fileName: outputFileName,
        filePath: outputFilePath,
        fileSize,
        downloadId
      };
    } catch (error) {
      console.error(`❌ Download failed:`, error);
      throw error;
    }
  }
}

const ipaTool = new IPATool();

// Routes
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeDownloads: ipaTool.activeDownloads.size
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/download', async (req, res) => {
  const { APPLE_ID, PASSWORD, CODE, APPID, appVerId } = req.body;
  const downloadId = `dl_${uuidv4().slice(0, 8)}`;
  
  console.log(`[${downloadId}] 📨 New download request for app: ${APPID}`);
  
  try {
    const uniqueDownloadPath = path.join(__dirname, 'downloads', generateRandomString());
    await fsPromises.mkdir(uniqueDownloadPath, { recursive: true });

    const result = await ipaTool.downipa({
      path: uniqueDownloadPath,
      APPLE_ID,
      PASSWORD,
      CODE,
      APPID,
      appVerId
    });

    if (result.require2FA) {
      return res.status(200).json({
        success: false,
        require2FA: true,
        message: result.message
      });
    }

    // Schedule cleanup
    setTimeout(async () => {
      try {
        await fsPromises.unlink(result.filePath).catch(() => {});
        await fsPromises.rm(uniqueDownloadPath, { recursive: true, force: true }).catch(() => {});
        console.log(`[${downloadId}] 🧹 Cleaned up: ${result.filePath}`);
      } catch (err) {
        console.error(`[${downloadId}] Cleanup error:`, err.message);
      }
    }, FILE_CLEANUP_DELAY);

    res.json({
      success: true,
      downloadUrl: `/files/${path.basename(uniqueDownloadPath)}/${result.fileName}`,
      fileName: result.fileName,
      appInfo: result.appInfo,
      downloadId
    });

  } catch (error) {
    console.error(`[${downloadId}] ❌ Download error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'An unknown error occurred',
      downloadId
    });
  }
});

app.use('/files', express.static(path.join(__dirname, 'downloads')));

// Error handlers
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    timestamp: new Date().toISOString()
  });
});

app.use((err, req, res, next) => {
  console.error('🔥 Server error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// Server startup
const server = app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🔗 Health check: http://localhost:${port}/health`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('🛑 Received shutdown signal');
  
  try {
    // Clean up active downloads
    if (ipaTool.activeDownloads.size > 0) {
      console.log(`⚠️ There are ${ipaTool.activeDownloads.size} active downloads - allowing 10 seconds to complete`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
    server.close(() => {
      console.log('🔴 Server closed');
      process.exit(0);
    });
  } catch (err) {
    console.error('Shutdown error:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
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

// Cấu hình Express
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/.well-known/acme-challenge', express.static(path.join(__dirname, '.well-known', 'acme-challenge')));

// Middleware để log request
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Trang chủ
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Các hằng số
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CONCURRENT_DOWNLOADS = 10;
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;

// Helper functions
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

async function downloadChunk({ url, start, end, output }) {
  const headers = { Range: `bytes=${start}-${end}` };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`Failed to fetch chunk: ${response.statusText}`);

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

    console.log('🔑 Authenticating with Apple ID...');
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

    if (user._state !== 'success') {
      if (user.failureType?.toLowerCase().includes('mfa')) {
        return {
          require2FA: true,
          message: user.customerMessage || '🔐 Apple yêu cầu mã xác minh 2FA. Vui lòng nhập mã để tiếp tục.'
        };
      }
      throw new Error(user.customerMessage || '❌ Đăng nhập thất bại. Kiểm tra Apple ID hoặc mật khẩu.');
    }

    console.log('📦 Fetching app info...');
    const app = await Store.download(APPID, appVerId, user);
    const songList0 = app?.songList?.[0];

    if (!app || app._state !== 'success' || !songList0 || !songList0.metadata) {
      if (app?.failureType?.toLowerCase().includes('mfa')) {
        return {
          require2FA: true,
          message: app.customerMessage || '🔐 Apple yêu cầu mã xác minh 2FA. Vui lòng nhập mã để tiếp tục.'
        };
      }
      if (app?.customerMessage?.toLowerCase().includes('verification')) {
        throw new Error('❌ Mã xác minh 2FA không hợp lệ hoặc đã hết hạn.');
      }
      throw new Error(app?.customerMessage || '❌ Không thể tải ứng dụng. Kiểm tra lại App ID hoặc tài khoản.');
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
    const outputFileName = `${appInfo.name}_${appInfo.version}_${uniqueString}.ipa`;
    const outputFilePath = path.join(downloadPath, outputFileName);
    const cacheDir = path.join(downloadPath, 'cache');

    await fsPromises.mkdir(cacheDir, { recursive: true });
    await clearCache(cacheDir);

    const resp = await fetch(songList0.URL);
    if (!resp.ok) throw new Error(`❌ Không thể tải IPA: ${resp.statusText}`);

    const fileSize = Number(resp.headers.get('content-length'));
    const numChunks = Math.ceil(fileSize / CHUNK_SIZE);

    console.log(`📥 Đang tải ${(fileSize / 1024 / 1024).toFixed(2)}MB trong ${numChunks} phần...`);

    const downloadQueue = Array.from({ length: numChunks }, (_, i) => {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
      const tempOutput = path.join(cacheDir, `part${i}`);
      return () => downloadChunk({ url: songList0.URL, start, end, output: tempOutput });
    });

    for (let i = 0; i < downloadQueue.length; i += MAX_CONCURRENT_DOWNLOADS) {
      await Promise.all(downloadQueue.slice(i, i + MAX_CONCURRENT_DOWNLOADS).map(fn => fn()));
    }

    console.log('🔗 Đang ghép các phần...');
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

    console.log('🖊️ Đang ký IPA...');
    const sigClient = new SignatureClient(songList0, APPLE_ID);
    await sigClient.loadFile(outputFilePath);
    await sigClient.appendMetadata().appendSignature();
    await sigClient.write();

    await fsPromises.rm(cacheDir, { recursive: true, force: true });
    console.log('✅ Tải thành công!');

    return {
      appInfo,
      fileName: outputFileName,
      filePath: outputFilePath
    };
  }
}

const ipaTool = new IPATool();

// Endpoint xác thực
app.post('/auth', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD } = req.body;
    
    if (!APPLE_ID || !PASSWORD) {
      return res.status(400).json({ 
        success: false, 
        error: 'Vui lòng nhập Apple ID và mật khẩu' 
      });
    }

    console.log(`🔑 Authenticating user: ${APPLE_ID}`);
    const user = await Store.authenticate(APPLE_ID, PASSWORD);

    if (user._state !== 'success') {
      if (user.failureType?.toLowerCase().includes('mfa')) {
        return res.json({
          require2FA: true,
          message: user.customerMessage || '🔐 Vui lòng nhập mã xác minh 2FA được gửi đến thiết bị của bạn'
        });
      }
      throw new Error(user.customerMessage || 'Đăng nhập thất bại');
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Lỗi xác thực' 
    });
  }
});

// Endpoint xác thực 2FA
app.post('/verify', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE } = req.body;
    
    if (!APPLE_ID || !PASSWORD || !CODE) {
      return res.status(400).json({ 
        success: false, 
        error: 'Vui lòng nhập đầy đủ thông tin' 
      });
    }

    console.log(`🔐 Verifying 2FA for: ${APPLE_ID}`);
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

    if (user._state !== 'success') {
      throw new Error(user.customerMessage || 'Mã xác minh không đúng');
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Lỗi xác thực 2FA' 
    });
  }
});

// Endpoint tải về
app.post('/download', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE, APPID, appVerId } = req.body;
    
    if (!APPLE_ID || !PASSWORD || !APPID) {
      return res.status(400).json({ 
        success: false, 
        error: 'Vui lòng nhập đầy đủ thông tin' 
      });
    }

    const uniqueDownloadPath = path.join(__dirname, 'app', generateRandomString(16));
    console.log(`📥 Starting download for app: ${APPID}`);

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

    // Tự động xóa file sau 30 phút
    setTimeout(async () => {
      try {
        await fsPromises.unlink(result.filePath);
        await fsPromises.rm(uniqueDownloadPath, { recursive: true, force: true });
        console.log(`🧹 Cleaned up: ${result.filePath}`);
      } catch (err) {
        console.error('Cleanup error:', err.message);
      }
    }, 30 * 60 * 1000);

    res.json({
      success: true,
      downloadUrl: `/files/${path.basename(uniqueDownloadPath)}/${result.fileName}`,
      fileName: result.fileName,
      appInfo: result.appInfo
    });

  } catch (error) {
    console.error('❌ Download error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Đã xảy ra lỗi khi tải ứng dụng'
    });
  }
});

// Phục vụ file tải về
app.use('/files', express.static(path.join(__dirname, 'app')));

// Xử lý 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Xử lý lỗi
app.use((err, req, res, next) => {
  console.error('🔥 Server error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Khởi động server
const server = app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🔗 Health check: http://localhost:${port}/health`);
});

// Xử lý tắt server
const shutdown = () => {
  console.log('🛑 Received shutdown signal');
  server.close(() => {
    console.log('🔴 Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
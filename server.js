import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs, { promises as fsPromises, createWriteStream, createReadStream } from 'fs';
import fetch from 'node-fetch';
import { Store } from './src/client.js';
import { SignatureClient } from './src/Signature.js';
import { v4 as uuidv4 } from 'uuid';

// =============================================
// CẤU HÌNH CƠ BẢN
// =============================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 5004;

// =============================================
// MIDDLEWARE
// =============================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/.well-known/acme-challenge', express.static(path.join(__dirname, '.well-known', 'acme-challenge')));

// =============================================
// ROUTES CƠ BẢN
// =============================================
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =============================================
// HÀM HỖ TRỢ
// =============================================
const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CONCURRENT_DOWNLOADS = 10;
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;

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
    await Promise.all(files.map(file => 
      fsPromises.unlink(path.join(cacheDir, file))
    ));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Cache clearance error: ${error.message}`);
    }
  }
}

// =============================================
// LỚP XỬ LÝ IPA
// =============================================
class IPATool {
  async downipa({ path: downloadPath, APPLE_ID, PASSWORD, CODE, APPID, appVerId } = {}) {
    downloadPath = downloadPath || '.';

    console.log('🔑 Authenticating with Apple ID...');
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

    if (user._state !== 'success') {
      if (user.failureType && user.failureType.toLowerCase().includes('mfa')) {
        return { 
          require2FA: true,
          message: 'Vui lòng nhập mã xác minh 2FA đã được gửi về thiết bị.'
        };
      }
      throw new Error(user.customerMessage || 'Authentication failed');
    }

    console.log('📦 Fetching app info...');
    const app = await Store.download(APPID, appVerId, user);

    // ✅ Kiểm tra dữ liệu trước khi truy cập metadata
    const songList0 = app?.songList?.[0];
    if (!songList0 || !songList0.metadata) {
      throw new Error(app.customerMessage || 'Không thể lấy thông tin ứng dụng. Có thể mã 2FA không hợp lệ hoặc hết hạn.');
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
    if (!resp.ok) throw new Error(`Failed to fetch IPA: ${resp.statusText}`);

    const fileSize = Number(resp.headers.get('content-length'));
    const numChunks = Math.ceil(fileSize / CHUNK_SIZE);

    console.log(`📥 Downloading ${(fileSize / 1024 / 1024).toFixed(2)}MB in ${numChunks} chunks...`);

    const downloadQueue = Array.from({ length: numChunks }, (_, i) => {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
      const tempOutput = path.join(cacheDir, `part${i}`);
      return () => downloadChunk({ url: songList0.URL, start, end, output: tempOutput });
    });

    for (let i = 0; i < downloadQueue.length; i += MAX_CONCURRENT_DOWNLOADS) {
      await Promise.all(downloadQueue.slice(i, i + MAX_CONCURRENT_DOWNLOADS).map(fn => fn()));
    }

    console.log('🔗 Merging chunks...');
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

    console.log('🖊️ Signing IPA...');
    const sigClient = new SignatureClient(songList0, APPLE_ID);
    await sigClient.loadFile(outputFilePath);
    await sigClient.appendMetadata().appendSignature();
    await sigClient.write();

    await fsPromises.rm(cacheDir, { recursive: true, force: true });
    console.log('✅ Download completed successfully!');

    return { 
      appInfo,
      fileName: outputFileName,
      filePath: outputFilePath 
    };
  }
}

// =============================================
// ROUTE DOWNLOAD
// =============================================
const ipaTool = new IPATool();

app.post('/download', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE, APPID, appVerId } = req.body;
    const uniqueDownloadPath = path.join(__dirname, 'app', generateRandomString(16));

    const result = await ipaTool.downipa({
      path: uniqueDownloadPath,
      APPLE_ID,
      PASSWORD,
      CODE,
      APPID,
      appVerId
    });

    // ✅ Nếu yêu cầu 2FA → trả lại để client hiển thị nhập mã
    if (result.require2FA) {
      return res.json({
        success: false,
        require2FA: true,
        message: result.message || 'Apple yêu cầu mã xác minh 2FA.'
      });
    }

    // ✅ Thiết lập xoá file sau 30 phút
    setTimeout(async () => {
      try {
        await fsPromises.unlink(result.filePath);
        await fsPromises.rm(uniqueDownloadPath, { recursive: true, force: true });
        console.log(`🧹 Cleaned up: ${result.filePath}`);
      } catch (err) {
        console.error('Cleanup error:', err.message);
      }
    }, 30 * 60 * 1000); // 30 phút

    // ✅ Trả kết quả thành công
    res.json({
      success: true,
      downloadUrl: `/files/${path.basename(uniqueDownloadPath)}/${result.fileName}`,
      fileName: result.fileName,
      appInfo: {
        name: result.appInfo?.name || '',
        artist: result.appInfo?.artist || '',
        version: result.appInfo?.version || '',
        bundleId: result.appInfo?.bundleId || '',
        releaseDate: result.appInfo?.releaseDate || ''
      }
    });

  } catch (error) {
    // 🛑 Trường hợp lỗi xác minh
    if (error.message?.toLowerCase().includes('2fa') || error.message?.includes('mfa')) {
      return res.status(200).json({
        success: false,
        require2FA: true,
        message: 'Apple yêu cầu mã xác minh 2FA. Vui lòng nhập mã và thử lại.'
      });
    }

    console.error('❌ Download error:', error.stack || error.message || error);
    res.status(500).json({
      success: false,
      error: error.message || 'An unknown error has occurred'
    });
  }
});

// =============================================
// CẤU HÌNH SERVER
// =============================================
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

// =============================================
// XỬ LÝ TÍN HIỆU DỪNG
// =============================================
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
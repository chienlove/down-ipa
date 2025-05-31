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

// Các hằng số
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CONCURRENT_DOWNLOADS = 3;
const MAX_RETRIES = 3;
const RETRY_DELAY = 3000;
const DOWNLOAD_TIMEOUT = 30000; // 30s
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 phút
const FILE_CLEANUP_DELAY = 30 * 60 * 1000; // 30 phút

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
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const fileStream = createWriteStream(output, { flags: 'a' });
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on('error', reject);
      fileStream.on('finish', resolve);
    });
    return true;
  } catch (error) {
    if (attempt >= MAX_RETRIES) throw error;
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    return downloadChunk({ url, start, end, output, attempt: attempt + 1 });
  } finally {
    clearTimeout(timeoutId);
  }
}

class IPATool {
  constructor() {
    this.activeDownloads = new Set();
    this.authSessions = new Map();
  }

  async validateInput({ APPLE_ID, PASSWORD, APPID }) {
    if (!APPLE_ID || !PASSWORD || !APPID) {
      throw new Error('Thiếu thông tin bắt buộc: Apple ID, mật khẩu hoặc App ID');
    }
    
    if (!/^\d+$/.test(APPID)) {
      throw new Error('App ID phải là chuỗi số');
    }
  }

  getErrorMessage(error) {
    const errorMessages = {
      'invalid_credentials': 'Sai Apple ID hoặc mật khẩu',
      'account_locked': 'Tài khoản đã bị khóa',
      'invalid_code': 'Mã 2FA không đúng',
      'expired_code': 'Mã 2FA đã hết hạn',
      'app_not_found': 'Không tìm thấy ứng dụng',
      'not_purchased': 'Bạn chưa mua ứng dụng này',
      'rate_limit': 'Thử lại sau ít phút',
      'network_error': 'Lỗi kết nối, kiểm tra mạng'
    };

    return errorMessages[error.code] || 
           error.customerMessage || 
           error.message || 
           'Lỗi không xác định';
  }

  async handle2FA(response, downloadId) {
    if (response.failureType?.includes('MFA') || 
        response.customerMessage?.includes('verification')) {
      
      this.authSessions.set(downloadId, {
        APPLE_ID: response.APPLE_ID,
        PASSWORD: response.PASSWORD,
        authToken: response.authToken,
        expires: Date.now() + SESSION_TIMEOUT
      });

      const message = response.customerMessage.includes('text') ? 
        'Nhập mã 6 số từ SMS' :
        'Nhập mã từ thiết bị tin cậy';
      
      return {
        require2FA: true,
        message: `🔐 ${message}`,
        downloadId
      };
    }
    return null;
  }

  async downipa({ path: downloadPath, APPLE_ID, PASSWORD, CODE, APPID, appVerId, downloadId = `dl_${uuidv4().slice(0, 8)}` }) {
    this.activeDownloads.add(downloadId);
    
    try {
      await this.validateInput({ APPLE_ID, PASSWORD, APPID });
      downloadPath = downloadPath || '.';

      // Kiểm tra session 2FA nếu có
      if (CODE && this.authSessions.has(downloadId)) {
        const session = this.authSessions.get(downloadId);
        if (session.expires < Date.now()) {
          throw new Error('Phiên làm việc hết hạn');
        }
        APPLE_ID = session.APPLE_ID;
        PASSWORD = session.PASSWORD;
      }

      // Xác thực
      console.log(`[${downloadId}] 🔑 Đang xác thực...`);
      let user;
      try {
        user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);
        
        const twoFAResult = await this.handle2FA(user, downloadId);
        if (twoFAResult) return twoFAResult;

        if (user._state !== 'success') {
          throw {
            code: user.failureType,
            customerMessage: user.customerMessage
          };
        }
      } catch (error) {
        throw new Error(this.getErrorMessage(error));
      }

      // Tải app
      console.log(`[${downloadId}] 📦 Đang tải thông tin ứng dụng...`);
      let app;
      try {
        app = await Store.download(APPID, appVerId, user);
        
        const appTwoFAResult = await this.handle2FA(app, downloadId);
        if (appTwoFAResult) return appTwoFAResult;

        if (app._state !== 'success' || !app.songList?.[0]?.metadata) {
          throw {
            code: app.failureType,
            customerMessage: app.customerMessage
          };
        }
      } catch (error) {
        throw new Error(this.getErrorMessage(error));
      }

      // Tải file IPA
      const song = app.songList[0];
      const appInfo = {
        name: song.metadata.bundleDisplayName,
        version: song.metadata.bundleShortVersionString,
        bundleId: song.metadata.softwareVersionBundleId
      };

      const outputDir = path.join(downloadPath, generateRandomString());
      await fsPromises.mkdir(outputDir, { recursive: true });

      const outputFile = path.join(outputDir, `${appInfo.name.replace(/[^\w]/g, '_')}_${appInfo.version}.ipa`);
      
      console.log(`[${downloadId}] 📥 Đang tải IPA...`);
      try {
        const headRes = await fetch(song.URL, { method: 'HEAD' });
        if (!headRes.ok) throw new Error('Không thể tải ứng dụng');
        
        const fileSize = parseInt(headRes.headers.get('content-length'));
        const chunks = Math.ceil(fileSize / CHUNK_SIZE);
        
        // Tải từng phần
        for (let i = 0; i < chunks; i += MAX_CONCURRENT_DOWNLOADS) {
          const chunkPromises = [];
          for (let j = 0; j < MAX_CONCURRENT_DOWNLOADS && i + j < chunks; j++) {
            const start = (i + j) * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
            const tempFile = path.join(outputDir, `chunk_${i + j}`);
            
            chunkPromises.push(
              downloadChunk({
                url: song.URL,
                start,
                end,
                output: tempFile
              })
            );
          }
          await Promise.all(chunkPromises);
        }
        
        // Ghép file
        const outputStream = createWriteStream(outputFile);
        for (let i = 0; i < chunks; i++) {
          const chunkFile = path.join(outputDir, `chunk_${i}`);
          await new Promise((resolve) => {
            createReadStream(chunkFile)
              .pipe(outputStream, { end: false })
              .on('end', () => fsPromises.unlink(chunkFile).then(resolve).catch(resolve));
          });
        }
        outputStream.end();
        
        // Ký file
        console.log(`[${downloadId}] 🖊️ Đang ký IPA...`);
        const sigClient = new SignatureClient(song, APPLE_ID);
        await sigClient.loadFile(outputFile);
        await sigClient.appendMetadata().appendSignature();
        await sigClient.write();

        // Dọn dẹp
        await fsPromises.rm(outputDir, { recursive: true, force: true }).catch(() => {});
        this.authSessions.delete(downloadId);

        return {
          success: true,
          downloadUrl: `/files/${path.basename(outputDir)}/${path.basename(outputFile)}`,
          fileName: path.basename(outputFile),
          appInfo,
          downloadId
        };

      } catch (error) {
        await fsPromises.rm(outputDir, { recursive: true, force: true }).catch(() => {});
        throw new Error(`Lỗi khi tải ứng dụng: ${error.message}`);
      }

    } catch (error) {
      this.authSessions.delete(downloadId);
      this.activeDownloads.delete(downloadId);
      console.error(`[${downloadId}] ❌ Lỗi:`, error.message);
      throw error;
    }
  }
}

const ipaTool = new IPATool();

// Routes
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    activeDownloads: ipaTool.activeDownloads.size,
    activeSessions: ipaTool.authSessions.size
  });
});

app.post('/download', async (req, res) => {
  const { APPLE_ID, PASSWORD, CODE, APPID, appVerId, downloadId } = req.body;
  
  try {
    const result = await ipaTool.downipa({
      path: path.join(__dirname, 'downloads'),
      APPLE_ID,
      PASSWORD,
      CODE,
      APPID,
      appVerId,
      downloadId
    });

    if (result.require2FA) {
      return res.status(200).json(result);
    }

    // Lên lịch dọn dẹp
    setTimeout(async () => {
      try {
        const filePath = path.join(__dirname, 'downloads', path.dirname(result.downloadUrl.split('/files/')[1]));
        await fsPromises.rm(filePath, { recursive: true, force: true });
        console.log(`[${result.downloadId}] 🧹 Đã dọn dẹp file`);
      } catch (err) {
        console.error(`[${result.downloadId}] Lỗi dọn dẹp:`, err.message);
      }
    }, FILE_CLEANUP_DELAY);

    res.json(result);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      downloadId: downloadId || 'unknown'
    });
  }
});

app.use('/files', express.static(path.join(__dirname, 'downloads')));

// Xử lý lỗi
app.use((req, res) => {
  res.status(404).json({ error: 'Không tìm thấy' });
});

app.use((err, req, res, next) => {
  console.error('🔥 Lỗi server:', err);
  res.status(500).json({ error: 'Lỗi server' });
});

// Khởi động server
const server = app.listen(port, () => {
  console.log(`🚀 Server đang chạy trên port ${port}`);
});

// Tắt server đúng cách
process.on('SIGTERM', () => {
  console.log('🛑 Nhận tín hiệu tắt server');
  server.close(() => {
    console.log('🔴 Server đã tắt');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});
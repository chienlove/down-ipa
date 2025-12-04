import express from 'express';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs, { promises as fsPromises, createWriteStream, createReadStream } from 'fs';
import fetch from 'node-fetch';
import { Store } from './src/client.js';
import { SignatureClient } from './src/Signature.js';
import { v4 as uuidv4 } from 'uuid';
import { Agent } from 'https';
import archiver from 'archiver';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import os from 'os';
import plist from 'plist';
import AdmZip from 'adm-zip';
import certApi from './routes/certApi.js';
import crypto from 'crypto'; // ✅ thêm cho HMAC token

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.set('trust proxy', true);
const port = process.env.PORT || 5004;

// Debug trust proxy
app.use((req, res, next) => {
  console.log('Request IP:', req.ip, 'X-Forwarded-For:', req.headers['x-forwarded-for']);
  next();
});

// R2 Configuration
const R2_PUBLIC_BASE = 'https://file.storeios.net';
const R2_ENDPOINT = 'https://b9b33e1228ae77e510897cc002c1735c.r2.cloudflarestorage.com';
const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
  maxAttempts: 3,
  retryMode: 'standard',
});

// R2 Helper Functions
async function uploadToR2({ key, filePath, contentType }) {
  try {
    console.log(`Preparing to upload to R2: ${key} (multi-part)`);
    const fileStream = createReadStream(filePath);

    const upload = new Upload({
      client: r2Client,
      params: {
        Bucket: 'file',
        Key: key,
        Body: fileStream,
        ContentType: contentType,
      },
      partSize: 20 * 1024 * 1024,
      queueSize: 1,
      leavePartsOnError: false,
      timeout: 300000,
    });

    console.log('Sending multi-part upload to R2...');
    upload.on('httpUploadProgress', (progress) => {
      if (progress?.loaded && progress?.total) {
        console.log(`R2 upload progress: ${Math.round((progress.loaded / progress.total) * 100)}%`);
      }
    });
    const result = await upload.done();
    console.log('Upload successful:', result);
    return result;
  } catch (error) {
    console.error('R2 upload error:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.$metadata?.httpStatusCode,
    });
    throw error;
  }
}

async function deleteFromR2(key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: 'file',
      Key: key,
    });
    await r2Client.send(command);
    console.log(`Successfully deleted ${key} from R2`);
  } catch (error) {
    console.error('R2 delete error:', error);
    throw error;
  }
}

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/.well-known/acme-challenge', express.static(path.join(__dirname, '.well-known', 'acme-challenge')));
app.use('/api', certApi);

// Rate-limiting cho /download (theo IP) - SỬA: tăng giới hạn từ 3 lên 5
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.'
  }
});
app.use('/download', limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    version: '1.0.3',
    timestamp: new Date().toISOString(),
  });
});

// R2 Connection Test Endpoint
app.get('/check-r2', async (req, res) => {
  try {
    const testKey = `test-${Date.now()}.txt`;
    const testPath = path.join(__dirname, 'test.txt');
    await fsPromises.writeFile(testPath, 'test content');
    await uploadToR2({
      key: testKey,
      filePath: testPath,
      contentType: 'text/plain',
    });
    await deleteFromR2(testKey);
    await fsPromises.unlink(testPath);
    res.json({ success: true, message: 'R2 connection is working' });
  } catch (error) {
    console.error('R2 test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to connect to R2',
    });
  }
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/go', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'go.html'));
});

// Constants
const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CONCURRENT_DOWNLOADS = 2;
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;
const REQUEST_TIMEOUT = 15000;
const MAX_FILE_SIZE_MB = 300;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Giới hạn số job đồng thời (phù hợp Heroku Hobby)
let currentJobs = 0;
const MAX_JOBS = 2; // có thể hạ xuống 1 nếu vẫn quá tải

// SỬA: Thêm hàm reset job counter tự động
setInterval(() => {
  if (currentJobs > 0) {
    console.log(`Auto-reset job counter. Current jobs: ${currentJobs}`);
    currentJobs = 0;
  }
}, 5 * 60 * 1000); // 5 phút

function generateRandomString(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

async function downloadChunk({ url, start, end, output, signal }) {
  const headers = { Range: `bytes=${start}-${end}` };
  const agent = new Agent({ rejectUnauthorized: false });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        headers,
        agent,
        signal: controller.signal,
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
      if (signal?.aborted) throw new Error('CANCELLED_BY_CLIENT');
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

async function checkMemory(requiredMB) {
  const freeMB = os.freemem() / 1024 / 1024;
  if (freeMB < requiredMB) {
    throw new Error(`Insufficient memory: ${freeMB.toFixed(2)}MB available, ${requiredMB}MB required`);
  }
}

// Lưu ý: statfs có thể không có trên một số runtime Node. Code gốc giữ nguyên.
async function checkDiskSpace(pathTarget, requiredSpace) {
  const stats = await fsPromises.statfs(pathTarget);
  const freeDisk = stats.bavail * stats.bsize;
  if (freeDisk < requiredSpace + 100 * 1024 * 1024) {
    throw new Error('Insufficient disk space for upload');
  }
}

async function extractMinimumOSVersion(ipaPath) {
  try {
    console.log(`Extracting MinimumOSVersion from IPA: ${ipaPath}`);
    const unzipDir = path.join(__dirname, 'temp_unzip', uuidv4());
    await fsPromises.mkdir(unzipDir, { recursive: true });
    console.log(`Created temp unzip directory: ${unzipDir}`);

    console.log('Extracting IPA file...');
    const zip = new AdmZip(ipaPath);
    zip.extractAllTo(unzipDir, true);
    console.log(`Extracted IPA to: ${unzipDir}`);

    const payloadDir = path.join(unzipDir, 'Payload');
    console.log(`Checking Payload directory: ${payloadDir}`);
    const dirents = await fsPromises.readdir(payloadDir, { withFileTypes: true });
    console.log(`Payload dir contents: ${dirents.map(d => d.name).join(', ')}`);
    const appDir = dirents.find(dirent => dirent.isDirectory() && dirent.name.endsWith('.app'))?.name;
    
    if (!appDir) {
      console.error('No .app directory found in Payload');
      throw new Error('No .app directory found in IPA');
    }
    console.log(`Found .app directory: ${appDir}`);

    const infoPlistPath = path.join(payloadDir, appDir, 'Info.plist');
    console.log(`Checking Info.plist: ${infoPlistPath}`);
    await fsPromises.access(infoPlistPath, fs.constants.F_OK);
    const plistContent = await fsPromises.readFile(infoPlistPath, 'utf8');
    console.log(`Read Info.plist (${plistContent.length} bytes)`);
    
    console.log('Parsing Info.plist...');
    const plistData = plist.parse(plistContent);
    console.log(`Parsed Info.plist keys: ${Object.keys(plistData).join(', ')}`);
    
    const minimumOSVersion = plistData.MinimumOSVersion || plistData.LSMinimumSystemVersion || 'Unknown';
    console.log(`Extracted MinimumOSVersion: ${minimumOSVersion}`);
    
    await fsPromises.rm(unzipDir, { recursive: true, force: true });
    console.log(`Cleaned up temp directory: ${unzipDir}`);
    
    return minimumOSVersion;
  } catch (error) {
    console.error('Error extracting MinimumOSVersion:', {
      message: error.message,
      stack: error.stack,
      ipaPath,
    });
    return 'Unknown';
  }
}

const progressMap = new Map();

// ✅================= BẢO MẬT PURCHASE TOKEN (CÁCH 4) =================
const PURCHASE_TOKEN_SECRET = process.env.PURCHASE_TOKEN_SECRET || '';
const purchaseTokenStore = new Map(); // token -> { ipHash, uaHash, exp, used }

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function getClientIp(req) {
  return (
    req.ip ||
    (req.headers['x-forwarded-for']?.split(',')[0] || '').trim() ||
    req.connection?.remoteAddress ||
    ''
  );
}

function createPurchaseToken(ip, ua) {
  if (!PURCHASE_TOKEN_SECRET) {
    console.warn('⚠ PURCHASE_TOKEN_SECRET is not set');
    return null;
  }
  const now = Date.now();
  const exp = now + 5000; // token sống 5s
  const nonce = crypto.randomBytes(16).toString('hex');
  const ipHash = hashValue(ip);
  const uaHash = hashValue(ua);
  const payload = `${ipHash}.${uaHash}.${now}.${exp}.${nonce}`;
  const sig = crypto.createHmac('sha256', PURCHASE_TOKEN_SECRET).update(payload).digest('hex');
  const token = `${payload}.${sig}`;

  purchaseTokenStore.set(token, {
    ipHash,
    uaHash,
    exp,
    used: false,
  });

  return token;
}

function verifyPurchaseToken(rawToken, ip, ua) {
  if (!PURCHASE_TOKEN_SECRET) {
    return { ok: false, code: 'NO_SECRET' };
  }
  if (!rawToken || typeof rawToken !== 'string') {
    return { ok: false, code: 'NO_TOKEN' };
  }

  const parts = rawToken.split('.');
  if (parts.length !== 6) {
    return { ok: false, code: 'BAD_FORMAT' };
  }

  const [ipHash, uaHash, tsStr, expStr, nonce, sig] = parts;
  const payload = `${ipHash}.${uaHash}.${tsStr}.${expStr}.${nonce}`;
  const expectedSig = crypto.createHmac('sha256', PURCHASE_TOKEN_SECRET).update(payload).digest('hex');

  if (expectedSig !== sig) {
    return { ok: false, code: 'BAD_SIGNATURE' };
  }

  const now = Date.now();
  const exp = Number(expStr) || 0;
  if (now > exp) {
    purchaseTokenStore.delete(rawToken);
    return { ok: false, code: 'EXPIRED' };
  }

  const currentIpHash = hashValue(ip);
  const currentUaHash = hashValue(ua);

  if (currentIpHash !== ipHash || currentUaHash !== uaHash) {
    return { ok: false, code: 'IP_OR_UA_MISMATCH' };
  }

  const saved = purchaseTokenStore.get(rawToken);
  if (!saved) {
    return { ok: false, code: 'NOT_FOUND' };
  }
  if (saved.used) {
    return { ok: false, code: 'ALREADY_USED' };
  }

  saved.used = true;
  purchaseTokenStore.set(rawToken, saved);

  setTimeout(() => {
    purchaseTokenStore.delete(rawToken);
  }, 10 * 1000);

  return { ok: true, code: 'OK' };
}

// Cleanup định kỳ tránh map phình
setInterval(() => {
  const now = Date.now();
  for (const [token, info] of purchaseTokenStore.entries()) {
    if (info.exp < now) {
      purchaseTokenStore.delete(token);
    }
  }
}, 60 * 1000);
// ✅==================================================================

class IPATool {
  async downipa({ path: downloadPath, APPLE_ID, PASSWORD, CODE, APPID, appVerId, requestId } = {}) {
    downloadPath = downloadPath || '.';
    console.log(`Starting download for app: ${APPID}, requestId: ${requestId}`);

    const globalAbort = new AbortController();
    const setProgress = (obj) => {
      const prev = progressMap.get(requestId) || {};
      progressMap.set(requestId, { ...prev, ...obj });
    };
    const isCancelled = () => {
      const p = progressMap.get(requestId);
      return p?.cancelRequested === true;
    };
    const ensureNotCancelled = () => {
      if (isCancelled()) throw new Error('CANCELLED_BY_CLIENT');
    };

    try {
      setProgress({ progress: 0, status: 'processing', abortController: globalAbort, cancelRequested: false });

      console.log('Authenticating with Apple ID...');
      const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

      if (user._state !== 'success') {
        if (user.failureType?.toLowerCase().includes('mfa')) {
          return {
            require2FA: true,
            message: user.customerMessage || '2FA verification required',
          };
        }
        throw new Error(user.customerMessage || 'Authentication failed');
      }

      setProgress({ progress: 10, status: 'processing' });
      ensureNotCancelled();

      console.log('Fetching app info...');
      const app = await Store.download(APPID, appVerId, user);
      const songList0 = app?.songList?.[0];

      if (!app || app._state !== 'success' || !songList0 || !songList0.metadata) {
        if (app?.failureType?.toLowerCase().includes('mfa')) {
          return {
            require2FA: true,
            message: app.customerMessage || '2FA verification required',
          };
        }
        
        const errorMessage = app?.customerMessage || 'Failed to get app information';
        if (errorMessage.includes('client not found') || errorMessage.includes('not found')) {
          throw new Error('APP_NOT_OWNED: Ứng dụng này chưa được mua hoặc không có trong mục đã mua của Apple ID này.');
        }
        
        throw new Error(errorMessage);
      }

      const appInfo = {
        name: songList0.metadata.bundleDisplayName || 'Unknown',
        artist: songList0.metadata.artistName || 'Unknown',
        version: songList0.metadata.bundleShortVersionString || 'Unknown',
        bundleId: songList0.metadata.softwareVersionBundleId || 'Unknown',
        releaseDate: songList0.metadata.releaseDate || 'Unknown',
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
        agent: new Agent({ rejectUnauthorized: false }),
        signal: globalAbort.signal,
      });

      if (!resp.ok) throw new Error(`Failed to download IPA: ${resp.statusText}`);

      const fileSize = Number(resp.headers.get('content-length') || '0');
      if (fileSize > MAX_FILE_SIZE_BYTES) {
        throw new Error(`FILE_TOO_LARGE: File IPA vượt quá giới hạn ${MAX_FILE_SIZE_MB}MB. Kích thước thực: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);
      }

      const numChunks = Math.ceil(fileSize / CHUNK_SIZE);

      console.log(`Downloading ${(fileSize / 1024 / 1024).toFixed(2)}MB in ${numChunks} chunks...`);

      try {
        await checkMemory(300);
      } catch (e) {
        if (String(e.message || '').startsWith('Insufficient memory')) {
          throw new Error(`OUT_OF_MEMORY: ${e.message}`);
        }
        throw e;
      }

      await checkDiskSpace(downloadPath, fileSize);
      setProgress({ progress: 20, status: 'processing' });
      ensureNotCancelled();

      const downloadQueue = Array.from({ length: numChunks }, (_, i) => {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
        const tempOutput = path.join(cacheDir, `part${i}`);
        return () => downloadChunk({
          url: songList0.URL,
          start,
          end,
          output: tempOutput,
          signal: globalAbort.signal,
        });
      });

      for (let i = 0; i < downloadQueue.length; i += MAX_CONCURRENT_DOWNLOADS) {
        ensureNotCancelled();
        await Promise.all(downloadQueue.slice(i, i + MAX_CONCURRENT_DOWNLOADS).map(fn => fn()));
      }

      console.log('Merging chunks...');
      const finalFile = createWriteStream(outputFilePath);
      for (let i = 0; i < numChunks; i++) {
        ensureNotCancelled();
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
      setProgress({ progress: 40, status: 'processing' });

      console.log('Extracting MinimumOSVersion...');
      const minimumOSVersion = await extractMinimumOSVersion(outputFilePath);
      appInfo.minimumOSVersion = minimumOSVersion;

      ensureNotCancelled();

      console.log('Signing IPA...');
      const sigClient = new SignatureClient(songList0, APPLE_ID);
      const signedDir = path.join(downloadPath, 'signed');
      await fsPromises.mkdir(signedDir, { recursive: true });
      await sigClient.processIPA(outputFilePath, signedDir);
      console.log('🔧 Using archiver to zip signed IPA...');

      await new Promise((resolve, reject) => {
        const output = createWriteStream(outputFilePath);
        const archive = archiver('zip', { zlib: { level: 3 } });

        output.on('close', () => {
          console.log(`✅ Archiver finished zipping. Final size: ${archive.pointer()} bytes`);
          output.close?.();
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

      await fsPromises.rm(signedDir, { recursive: true, force: true });
      console.log('🧹 Deleted temporary signed directory to free disk.');
      setProgress({ progress: 60, status: 'processing' });

      await new Promise(resolve => setTimeout(resolve, 500));

      let ipaUrl = `/files/${path.basename(downloadPath)}/${outputFileName}`;
      let installUrl = null;
      let r2Success = false;

      try {
        try {
          await checkMemory(300);
        } catch (e) {
          if (String(e.message || '').startsWith('Insufficient memory')) {
            throw new Error(`OUT_OF_MEMORY: ${e.message}`);
          }
          throw e;
        }

        await checkDiskSpace(downloadPath, fileSize);
        ensureNotCancelled();

        const ipaKey = `ipas/${outputFileName}`;
        await uploadToR2({
          key: ipaKey,
          filePath: outputFilePath,
          contentType: 'application/octet-stream',
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
          contentType: 'application/xml',
        });

        await fsPromises.unlink(plistPath);
        console.log(`🧹 Deleted local plist file: ${plistPath}`);
        setProgress({ progress: 80, status: 'processing' });

        ipaUrl = `${R2_PUBLIC_BASE}/${ipaKey}`;
        installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(`${R2_PUBLIC_BASE}/${plistKey}`)}`;
        r2Success = true;

        setTimeout(async () => {
          try {
            await deleteFromR2(ipaKey);
            await deleteFromR2(plistKey);
            console.log('🧼 Auto-cleaned file on R2');
          } catch (err) {
            console.error('❌ R2 cleanup error:', err.message);
          }
        }, 5 * 60 * 1000);

      } catch (error) {
        console.error('R2 upload failed (using local file):', error);
        setProgress({ progress: 0, status: 'error', error: error.message, code: 'R2_UPLOAD_FAILED' });
        throw error;
      }

      await fsPromises.rm(cacheDir, { recursive: true, force: true });
      console.log('Download completed successfully!');
      setProgress({ 
        progress: 100, 
        status: 'complete', 
        downloadUrl: ipaUrl, 
        installUrl, 
        r2Success,
        appInfo,
        fileSizeMB: (fileSize / 1024 / 1024).toFixed(2)
      });

      return {
        appInfo,
        fileName: outputFileName,
        filePath: outputFilePath,
        downloadUrl: ipaUrl,
        installUrl,
        r2UploadSuccess: r2Success,
        fileSizeMB: (fileSize / 1024 / 1024).toFixed(2)
      };
    } catch (error) {
      console.error('Download error:', error);
      const msg = String(error.message || '');
      let code = undefined;
      
      if (msg.startsWith('FILE_TOO_LARGE')) code = 'FILE_TOO_LARGE';
      else if (msg.startsWith('OUT_OF_MEMORY')) code = 'OUT_OF_MEMORY';
      else if (msg === 'CANCELLED_BY_CLIENT') code = 'CANCELLED_BY_CLIENT';
      else if (msg.includes('APP_NOT_OWNED')) code = 'APP_NOT_OWNED';
      else if (msg.includes('client not found') || msg.includes('not found')) code = 'APP_NOT_OWNED';
      else if (msg.includes('too many requests')) code = 'RATE_LIMIT_EXCEEDED';

      progressMap.set(requestId, { progress: 0, status: 'error', error: msg, code });
      
      currentJobs = Math.max(0, currentJobs - 1);
      throw error;
    } finally {
      console.log(`Finished processing requestId: ${requestId}`);
    }
  }
}

const ipaTool = new IPATool();

/* ================= reCAPTCHA integration (download) ================= */

// endpoint trả sitekey để client render explicit
app.get('/recaptcha-sitekey', (req, res) => {
  const siteKey = process.env.RECAPTCHA_SITE_KEY || '';
  res.json({ siteKey });
});

async function verifyRecaptcha(req, res, next) {
  try {
    const token = req.body?.recaptchaToken;
    if (!token) {
      return res.status(400).json({ success: false, error: 'RECAPTCHA_REQUIRED', message: 'Thiếu reCAPTCHA token' });
    }
    const params = new URLSearchParams();
    params.append('secret', process.env.RECAPTCHA_SECRET || '');
    params.append('response', token);

    const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await resp.json();
    if (!data.success) {
      return res.status(403).json({ success: false, error: 'RECAPTCHA_FAILED', message: 'Xác minh reCAPTCHA thất bại' });
    }
    return next();
  } catch (err) {
    console.error('reCAPTCHA verify error:', err);
    return res.status(500).json({ success: false, error: 'RECAPTCHA_ERROR', message: 'Lỗi xác minh reCAPTCHA' });
  }
}

/* ================= SSE progress ================= */
app.get('/download-progress/:id', (req, res) => {
  const id = req.params.id;
  console.log(`SSE connection opened for progress id: ${id}`);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    res.write(`: keep-alive ${Date.now()}\n\n`);
  }, 15000);

  const interval = setInterval(() => {
    const progress = progressMap.get(id) || { progress: 0, status: 'pending' };
    sendProgress({ id, ...progress });
    if (progress.status === 'complete' || progress.status === 'error') {
      console.log(`Closing SSE for id: ${id}, status: ${progress.status}`);
      clearInterval(interval);
      clearInterval(heartbeat);
      progressMap.delete(id);
      res.end();
    }
  }, 2000);

  req.on('close', () => {
    console.log(`SSE connection closed by client for id: ${id} — marking cancelRequested`);
    clearInterval(interval);
    clearInterval(heartbeat);
    const p = progressMap.get(id);
    if (p) {
      progressMap.set(id, { ...p, cancelRequested: true });
      try {
        p.abortController?.abort();
      } catch {}
    }
    res.end();
  });
});

app.get('/status/:id', (req, res) => {
  const id = req.params.id;
  const progress = progressMap.get(id) || { progress: 0, status: 'pending' };
  res.json({ id, ...progress });
});

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

// ================= reCAPTCHA cho purchased.storeios.net =================
const PURCHASED_RECAPTCHA_SECRET = process.env.PURCHASED_SECRET_PURCHASED || '';

async function verifyRecaptchaForPurchase(token) {
  if (!token) {
    return { ok: false, code: 'RECAPTCHA_REQUIRED' };
  }

  if (!PURCHASED_RECAPTCHA_SECRET) {
    console.warn('⚠ PURCHASED_SECRET_PURCHASED chưa được cấu hình trong Heroku');
    return { ok: false, code: 'NO_SECRET' };
  }

  const params = new URLSearchParams();
  params.append('secret', PURCHASED_RECAPTCHA_SECRET);
  params.append('response', token);

  const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await resp.json();
  if (!data.success) {
    return { ok: false, code: 'RECAPTCHA_FAILED', data };
  }

  return { ok: true, code: 'OK', data };
}

// ✅ NEW: ROUTE SINH TOKEN BẢO MẬT CHO /purchase
app.post('/purchase-token', (req, res) => {
  try {
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    const token = createPurchaseToken(ip, ua);
    if (!token) {
      return res.status(500).json({
        success: false,
        error: 'SERVER_TOKEN_ERROR',
        message: 'Không tạo được token bảo mật'
      });
    }
    return res.json({
      success: true,
      token,
      ttl: 5
    });
  } catch (e) {
    console.error('Error in /purchase-token:', e);
    return res.status(500).json({
      success: false,
      error: e.message || 'Lỗi server khi tạo token'
    });
  }
});

// ============================
// ROUTE: /purchase (ipatool v2 + STDQ + 2FA friendly)
// ============================
app.post('/purchase', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE, input, recaptchaToken } = req.body || {};

    // ✅ 1) Kiểm tra token bảo mật
    const clientIp = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    const rawToken = req.headers['x-purchase-token'] || '';
    const tokenCheck = verifyPurchaseToken(rawToken, clientIp, ua);

    if (!tokenCheck.ok) {
      console.warn('Invalid purchase token:', tokenCheck);
      return res.status(403).json({
        success: false,
        error: 'Yêu cầu không hợp lệ hoặc đã hết hạn. Vui lòng tải lại trang và thử lại.',
        tokenCode: tokenCheck.code,
      });
    }

    // ✅ 2) Check reCAPTCHA CHỈ cho lần submit đầu (chưa có CODE 2FA)
if (!CODE || !String(CODE).trim()) {
    const vr = await verifyRecaptchaForPurchase(recaptchaToken);
    if (!vr.ok) {
        let msg = 'Xác thực reCAPTCHA thất bại. Vui lòng tải lại trang và thử lại.';
        if (vr.code === 'RECAPTCHA_REQUIRED') {
            msg = 'Vui lòng tích vào ô reCAPTCHA trước khi tiếp tục.';
        } else if (vr.code === 'NO_SECRET') {
            msg = 'reCAPTCHA chưa được cấu hình đúng trên server.';
        }

        return res.status(400).json({
            success: false,
            recaptchaFailed: true,
            error: msg,
            recaptchaCode: vr.code,
        });
    }
}

    if (!APPLE_ID || !PASSWORD || !input) {
      return res.status(400).json({
        success: false,
        error: "APPLE_ID, PASSWORD và input là bắt buộc."
      });
    }

    // ==============================
    // 1) Chuẩn hóa input
    // ==============================
    const raw = String(input).trim();
    let bundleId = null;
    let appId = null;

    if (/^https?:\/\/apps\.apple\.com\//i.test(raw)) {
      const m = raw.match(/id(\d{6,})/);
      if (m) appId = m[1];
    } else if (/^\d{6,}$/.test(raw)) {
      appId = raw;
    } else if (raw.includes('.')) {
      bundleId = raw;
    }

    async function lookupBundle(id) {
      if (!id) return null;
      const countries = ["vn", "us", "jp", "kr", "cn", "tw", "hk", "sg"];
      for (const c of countries) {
        try {
          const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=${c}`);
          if (!r.ok) continue;
          const j = await r.json();
          if (j.resultCount > 0 && j.results[0].bundleId) return j.results[0];
        } catch {}
      }
      return null;
    }

    let meta = null;
    if (!bundleId && appId) {
      meta = await lookupBundle(appId);
      if (meta?.bundleId) bundleId = meta.bundleId;
    }

    if (!bundleId) {
      return res.status(400).json({
        success: false,
        error: "Không lấy được Bundle ID từ input. Hãy nhập bundle id dạng com.xxx.yyy hoặc URL/App ID hợp lệ."
      });
    }

    let appInfo = meta
      ? {
          name: meta.trackName,
          bundleId,
          version: meta.version,
          artistName: meta.sellerName || meta.artistName,
          appId: meta.trackId || appId,
          icon: meta.artworkUrl512 || meta.artworkUrl100 || meta.artworkUrl60
        }
      : {
          name: null,
          bundleId,
          version: null,
          artistName: null,
          appId,
          icon: null
        };

    // ==============================
    // 2) run ipatool
    // ==============================
    const keychainPass = `${APPLE_ID}-storeios-pass`;

    const runIpatool = (args) =>
      new Promise((resolve, reject) => {
        const finalArgs = ["--keychain-passphrase", keychainPass, ...args];

        execFile("./ipatool", finalArgs, (err, stdout, stderr) => {
          const out = stdout?.toString() || "";
          const errOut = stderr?.toString() || "";

          if (!out.trim()) {
            if (err) return reject(new Error(errOut || err.message));
            return resolve({});
          }

          try {
            const parsed = JSON.parse(out);
            if (err) {
              parsed.__exitCode = err.code;
              parsed.__signal = err.signal;
            }
            resolve(parsed);
          } catch {
            reject(new Error("ipatool xuất ra dữ liệu không phải JSON: " + out.slice(0, 400)));
          }
        });
      });

    // ==============================
    // 3) Auth Login
    // ==============================
    const authArgs = [
      "auth",
      "login",
      "--email",
      APPLE_ID,
      "--password",
      PASSWORD,
      "--format",
      "json",
      "--non-interactive"
    ];
    if (CODE) authArgs.push("--auth-code", CODE);

    const auth = await runIpatool(authArgs);

    if (auth.success === false || auth.error) {
      const rawErr = (auth.error || auth.message || "").toString();

      const looksLike2FA =
        /two[- ]factor|2fa|required|auth code/i.test(rawErr) ||
        /failed to get account: failed to get item/i.test(rawErr);

      if (looksLike2FA && !CODE) {
        return res.status(401).json({
          success: false,
          require2FA: true,
          error: "Vui lòng nhập mã 2FA gửi về thiết bị.",
          note:
            "Nếu không thấy mã gửi về thiết bị, rất có thể bạn đã nhập sai Apple ID hoặc mật khẩu. Vui lòng kiểm tra lại và thử lại.",
          rawAuth: auth
        });
      }

      let friendly = rawErr;
      if (!friendly || /something went wrong/i.test(friendly)) {
        friendly = "Đăng nhập thất bại. Vui lòng kiểm tra lại Apple ID và mật khẩu.";
      }

      return res.status(400).json({ success: false, error: friendly, rawAuth: auth });
    }

    // ==============================
    // 4) Purchase
    // ==============================
    const purchaseArgs = ["purchase", "-b", bundleId, "--format", "json", "--non-interactive"];
    const purchase = await runIpatool(purchaseArgs);

    if (purchase.success === false || purchase.error) {
      const rawErr = (purchase.error || purchase.message || "").toString();

      const isSTDQ = /STDQ/i.test(rawErr);
      const needs2FA =
        /failed to get account: failed to get item/i.test(rawErr) ||
        /two[- ]factor|2fa|required|auth code/i.test(rawErr);

      if (needs2FA && !CODE) {
        return res.status(401).json({
          success: false,
          require2FA: true,
          error: "Vui lòng nhập mã 2FA gửi về thiết bị.",
          note:
            "Nếu không thấy mã gửi về thiết bị, rất có thể bạn đã nhập sai Apple ID hoặc mật khẩu. Vui lòng kiểm tra lại và thử lại.",
          rawPurchase: purchase
        });
      }

      if (isSTDQ) {
        return res.json({
          success: true,
          alreadyInPurchased: true,
          message:
            "Ứng dụng này đã có trong mục “Đã mua”. Bạn có thể mở App Store → tab Đã mua để kiểm tra.",
          app: appInfo,
          rawPurchase: purchase
        });
      }

      return res.status(400).json({
        success: false,
        error: rawErr || "ipatool purchase thất bại.",
        rawPurchase: purchase
      });
    }

    // ==============================
    // 5) Thành công
    // ==============================
    return res.json({
      success: true,
      message: "Thêm ứng dụng vào “Đã mua” thành công.",
      app: appInfo
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message || "Lỗi server khi gọi ipatool purchase."
    });
  }
});

// Download (áp verifyRecaptcha + giới hạn số job)
app.post('/download', verifyRecaptcha, async (req, res) => {
  console.log('Received /download request:', { body: { ...req.body, PASSWORD: '***' } });
  try {
    const { APPLE_ID, PASSWORD, CODE, APPID, appVerId } = req.body;

    if (!APPLE_ID || !PASSWORD || !APPID) {
      console.log('Missing required fields in /download');
      return res.status(400).json({
        success: false,
        error: 'Required fields missing',
      });
    }

    if (currentJobs >= MAX_JOBS) {
      console.warn(`Server busy: currentJobs=${currentJobs}, MAX_JOBS=${MAX_JOBS}`);
      return res.status(429).json({
        success: false,
        error: 'SERVER_BUSY',
        message: 'Máy chủ đang bận, vui lòng thử lại sau.',
      });
    }

    const requestId = generateRandomString();
    const uniqueDownloadPath = path.join(__dirname, 'app', generateRandomString());
    console.log(`Download request for app: ${APPID}, requestId: ${requestId}`);
    currentJobs += 1;

    res.json({
      success: true,
      status: 'pending',
      requestId,
      message: 'Processing started, check status via /status/:id or /download-progress/:id',
    });

    setImmediate(async () => {
      try {
        const result = await ipaTool.downipa({
          path: uniqueDownloadPath,
          APPLE_ID,
          PASSWORD,
          CODE,
          APPID,
          appVerId,
          requestId,
        });

        if (result?.require2FA) {
          progressMap.set(requestId, {
            progress: 0,
            status: 'error',
            error: '2FA required',
            require2FA: true,
            message: result.message,
          });
          currentJobs = Math.max(0, currentJobs - 1);
          return;
        }

        console.log('Preparing to send response:', {
          downloadUrl: result.downloadUrl,
          installUrl: result.installUrl,
          r2UploadSuccess: result.r2UploadSuccess,
        });

        setTimeout(async () => {
          try {
            await fsPromises.unlink(result.filePath);
            await fsPromises.rm(path.dirname(result.filePath), { recursive: true, force: true });
            await fsPromises.rm(path.join(path.dirname(result.filePath), 'signed'), { recursive: true, force: true });
            console.log(`Cleaned up local file and folder: ${result.filePath}`);
          } catch (err) {
            console.error('Cleanup IPA error:', err.message);
          }

          if (result.plistPath) {
            try {
              await fsPromises.unlink(result.plistPath);
              console.log(`Deleted local plist file: ${result.plistPath}`);
            } catch (err) {
              console.error('Cleanup plist error:', err.message);
            }
          }
        }, 1000);
        
        currentJobs = Math.max(0, currentJobs - 1);
      } catch (error) {
        console.error('Background download error:', error);
        const msg = String(error.message || '');
        let code = undefined;
        if (msg.startsWith('FILE_TOO_LARGE')) code = 'FILE_TOO_LARGE';
        else if (msg.startsWith('OUT_OF_MEMORY')) code = 'OUT_OF_MEMORY';
        else if (msg === 'CANCELLED_BY_CLIENT') code = 'CANCELLED_BY_CLIENT';
        else if (msg.includes('APP_NOT_OWNED')) code = 'APP_NOT_OWNED';
        else if (msg.includes('too many requests')) code = 'RATE_LIMIT_EXCEEDED';

        progressMap.set(requestId, {
          progress: 0,
          status: 'error',
          error: msg || 'Download failed',
          code,
        });
        
        currentJobs = Math.max(0, currentJobs - 1);
      }
    });
  } catch (error) {
    console.error('Download error:', error);
    currentJobs = Math.max(0, currentJobs - 1);
    res.status(500).json({
      success: false,
      error: error.message || 'Download failed',
    });
  }
});

// Verify 2FA
app.post('/verify', async (req, res) => {
  console.log('Received /verify request:', { body: { ...req.body, PASSWORD: '***' } });
  try {
    const { APPLE_ID, PASSWORD, CODE } = req.body;

    if (!APPLE_ID || !PASSWORD || !CODE) {
      console.log('Missing required fields in /verify');
      return res.status(400).json({
        success: false,
        error: 'All fields are required',
      });
    }

    console.log(`Verifying 2FA for: ${APPLE_ID}`);
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

    if (user._state !== 'success') {
      console.log('2FA verification failed:', user.customerMessage);
      throw new Error(user.customerMessage || 'Verification failed');
    }

    console.log('2FA verification successful');
    res.json({
      success: true,
      dsid: user.dsPersonId,
    });
  } catch (error) {
    console.error('Verify error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Verification error',
    });
  }
});

/* ================ Trang trung gian đếm ngược 10s ================= */
app.get('/go', (req, res) => {
  const { url, type } = req.query || {};
  const safeUrl = typeof url === 'string' ? url : '#';
  const typeText = type === 'install' ? 'Cài trực tiếp' : 'Tải file IPA';

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`
<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Đang chuyển hướng...</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f9fafb; margin:0; padding:0; }
  .wrap { max-width:560px; margin:8vh auto; background:#fff; border-radius:12px; padding:24px; box-shadow:0 10px 30px rgba(0,0,0,.06); }
  h1 { margin:0 0 12px; font-size:20px; }
  p { margin:6px 0; color:#374151; }
  .count { font-weight:700; }
  .btn { display:inline-block; margin-top:14px; background:#2563eb; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; }
  .btn:hover { background:#1e40af; }
  .muted { color:#6b7280; font-size:13px; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Chuẩn bị ${typeText}</h1>
    <p>Vui lòng chờ <span id="count" class="count">10</span> giây...</p>
    <p class="muted">Mẹo: Giữ tab mở để tránh gián đoạn. File càng lớn thời gian xử lý càng lâu.</p>
    <a id="go" href="${safeUrl}" class="btn" rel="noopener">Đi ngay</a>
  </div>
<script>
  (function(){
    var s=10, el=document.getElementById('count'), go=document.getElementById('go');
    var iv=setInterval(function(){
      s--; if (s<=0){ clearInterval(iv); window.location.href = go.href; }
      if (el) el.textContent = s;
    }, 1000);
  })();
</script>
</body>
</html>
  `);
});

/* ================= 404 & error handlers ================= */
app.use((req, res) => {
  console.log(`404 Not Found: ${req.method} ${req.url}`);
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
server.setTimeout(600000);

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

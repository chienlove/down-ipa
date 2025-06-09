import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs, { promises as fsPromises, createWriteStream, createReadStream } from 'fs';
import fetch from 'node-fetch';
import { Store } from './src/client.js';
import { SignatureClient } from './src/Signature.js';
import { v4 as uuidv4 } from 'uuid';
import { Agent } from 'https';
import AWS from 'aws-sdk'; // R2 INTEGRATION

// R2 INTEGRATION START
const {
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_ENDPOINT,
  R2_BUCKET_NAME
} = process.env;

const r2 = new AWS.S3({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  endpoint: R2_ENDPOINT,
  signatureVersion: 'v4',
  region: 'auto'
});

async function uploadToR2({ key, filePath, contentType }) {
  const fileContent = await fsPromises.readFile(filePath);
  await r2.putObject({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: fileContent,
    ContentType: contentType,
    ACL: 'public-read',
  }).promise();
}

async function deleteFromR2(key) {
  await r2.deleteObject({
    Bucket: R2_BUCKET_NAME,
    Key: key
  }).promise();
}
// R2 INTEGRATION END

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 5004;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/.well-known/acme-challenge', express.static(path.join(__dirname, '.well-known', 'acme-challenge')));

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    version: '1.0.1',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CONCURRENT_DOWNLOADS = 10;
const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;
const REQUEST_TIMEOUT = 15000;

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
      const response = await fetch(url, { headers, agent, signal: controller.signal });
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
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);
    if (user._state !== 'success') {
      if (user.failureType?.toLowerCase().includes('mfa')) {
        return { require2FA: true, message: user.customerMessage || '2FA required' };
      }
      throw new Error(user.customerMessage || 'Authentication failed');
    }

    const app = await Store.download(APPID, appVerId, user);
    const songList0 = app?.songList?.[0];
    if (!app || app._state !== 'success' || !songList0?.metadata) {
      throw new Error(app?.customerMessage || 'Failed to get app info');
    }

    const appInfo = {
      name: songList0.metadata.bundleDisplayName,
      artist: songList0.metadata.artistName,
      version: songList0.metadata.bundleShortVersionString,
      bundleId: songList0.metadata.softwareVersionBundleId,
      releaseDate: songList0.metadata.releaseDate
    };

    await fsPromises.mkdir(downloadPath, { recursive: true });
    const outputFileName = `${appInfo.name.replace(/[^a-z0-9]/gi, '_')}_${appInfo.version}_${uuidv4()}.ipa`;
    const outputFilePath = path.join(downloadPath, outputFileName);
    const cacheDir = path.join(downloadPath, 'cache');

    await fsPromises.mkdir(cacheDir, { recursive: true });
    await clearCache(cacheDir);

    const resp = await fetch(songList0.URL, { agent: new Agent({ rejectUnauthorized: false }) });
    if (!resp.ok) throw new Error(`Failed to download IPA: ${resp.statusText}`);
    const fileSize = Number(resp.headers.get('content-length'));
    const numChunks = Math.ceil(fileSize / CHUNK_SIZE);

    const downloadQueue = Array.from({ length: numChunks }, (_, i) => {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
      const tempOutput = path.join(cacheDir, `part${i}`);
      return () => downloadChunk({ url: songList0.URL, start, end, output: tempOutput });
    });

    for (let i = 0; i < downloadQueue.length; i += MAX_CONCURRENT_DOWNLOADS) {
      await Promise.all(downloadQueue.slice(i, i + MAX_CONCURRENT_DOWNLOADS).map(fn => fn()));
    }

    const finalFile = createWriteStream(outputFilePath);
    for (let i = 0; i < numChunks; i++) {
      const tempOutput = path.join(cacheDir, `part${i}`);
      const tempStream = createReadStream(tempOutput);
      await new Promise(resolve => {
        tempStream.pipe(finalFile, { end: false });
        tempStream.on('end', () => fsPromises.unlink(tempOutput).then(resolve));
      });
    }
    finalFile.end();

    const sigClient = new SignatureClient(songList0, APPLE_ID);
    await sigClient.loadFile(outputFilePath);
    await sigClient.appendMetadata().appendSignature();
    await sigClient.write();

    await fsPromises.rm(cacheDir, { recursive: true, force: true });

    return {
      appInfo,
      fileName: outputFileName,
      filePath: outputFilePath
    };
  }
}

const ipaTool = new IPATool();

app.post('/download', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE, APPID, appVerId } = req.body;
    const uniqueDownloadPath = path.join(__dirname, 'app', generateRandomString());
    const result = await ipaTool.downipa({ path: uniqueDownloadPath, APPLE_ID, PASSWORD, CODE, APPID, appVerId });

    if (result.require2FA) {
      return res.json({ success: false, require2FA: true, message: result.message });
    }

    // R2 INTEGRATION: Upload IPA & PLIST
    const ipaKey = `ipas/${result.fileName}`;
    await uploadToR2({
      key: ipaKey,
      filePath: result.filePath,
      contentType: 'application/octet-stream'
    });

    const plistName = result.fileName.replace(/\.ipa$/, '.plist');
    const plistPath = path.join(uniqueDownloadPath, plistName);
    const plistKey = `manifests/${plistName}`;
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
 "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
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
          <string>${R2_ENDPOINT}/${ipaKey}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${result.appInfo.bundleId}</string>
        <key>bundle-version</key>
        <string>${result.appInfo.version}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${result.appInfo.name}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;

    await fsPromises.writeFile(plistPath, plistContent, 'utf8');
    await uploadToR2({
      key: plistKey,
      filePath: plistPath,
      contentType: 'application/xml'
    });

    setTimeout(async () => {
      try {
        await deleteFromR2(ipaKey);
        await deleteFromR2(plistKey);
        console.log(`R2 cleanup done: ${ipaKey}, ${plistKey}`);
      } catch (err) {
        console.error('R2 cleanup failed:', err.message);
      }
    }, 5 * 60 * 1000);

    res.json({
      success: true,
      fileName: result.fileName,
      appInfo: result.appInfo,
      installUrl: `itms-services://?action=download-manifest&url=${R2_ENDPOINT}/${plistKey}`
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ success: false, error: error.message || 'Download failed' });
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
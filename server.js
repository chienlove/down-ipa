import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs, { promises as fsPromises } from 'fs';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Store } from './src/client.js';
import { SignatureClient } from './src/Signature.js';
import { v4 as uuidv4 } from 'uuid';
import { Agent } from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 5004;

// R2 Configuration
const s3Client = new S3Client({
  region: 'auto',
  endpoint: 'https://file.storeios.net',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Auth endpoint
app.post('/auth', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD } = req.body;
    const user = await Store.authenticate(APPLE_ID, PASSWORD);

    const needs2FA = (
      user.customerMessage?.toLowerCase().includes('mã xác minh') ||
      user.customerMessage?.toLowerCase().includes('two-factor') ||
      user.customerMessage?.toLowerCase().includes('mfa') ||
      user.customerMessage?.toLowerCase().includes('code') ||
      user.failureType?.toLowerCase().includes('mfa')
    );

    // SỬA LỖI: Luôn trả về require2FA nếu cần
    if (needs2FA) {
      return res.json({
        require2FA: true,  // Đảm bảo có trường này
        message: user.customerMessage || 'Tài khoản cần xác minh 2FA',
        dsid: user.dsPersonId
      });
    }

    if (user._state === 'success') {
      return res.json({
        success: true,
        require2FA: false,  // Thêm trường này để rõ ràng
        dsid: user.dsPersonId
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

// Verify 2FA endpoint
app.post('/verify', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE } = req.body;
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

    if (user._state !== 'success') {
      throw new Error(user.customerMessage || 'Verification failed');
    }

    res.json({ success: true, dsid: user.dsPersonId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download endpoint with R2 integration
app.post('/download', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE, APPID, appVerId } = req.body;
    
    // Authenticate and get app info
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE || undefined);
    const app = await Store.download(APPID, appVerId, user);
    
    if (!app.songList?.[0]?.metadata) {
      throw new Error('Failed to get app information');
    }

    const appInfo = {
      name: app.songList[0].metadata.bundleDisplayName,
      artist: app.songList[0].metadata.artistName,
      version: app.songList[0].metadata.bundleShortVersionString,
      bundleId: app.songList[0].metadata.softwareVersionBundleId,
      releaseDate: app.songList[0].metadata.releaseDate
    };

    // Generate unique filename
    const fileName = `${appInfo.name.replace(/[^a-z0-9]/gi, '_')}_${appInfo.version}_${uuidv4().slice(0, 8)}.ipa`;
    
    // Upload to R2
    const ipaResponse = await fetch(app.songList[0].URL, { agent: new Agent({ rejectUnauthorized: false }) });
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      Body: ipaResponse.body,
      ContentType: 'application/octet-stream'
    }));

    // Generate install plist
    const plistContent = generatePlistContent(fileName, appInfo);
    const plistFileName = `${fileName.split('.')[0]}.plist`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: plistFileName,
      Body: plistContent,
      ContentType: 'application/xml'
    }));

    // Schedule cleanup after 5 minutes
    setTimeout(async () => {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileName
      }));
      await s3Client.send(new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: plistFileName
      }));
    }, 5 * 60 * 1000);

    res.json({
      success: true,
      downloadUrl: `https://file.storeios.net/${fileName}`,
      installUrl: `itms-services://?action=download-manifest&url=https://file.storeios.net/${plistFileName}`,
      fileName,
      appInfo
    });

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to generate plist content
function generatePlistContent(fileName, appInfo) {
  return `<?xml version="1.0" encoding="UTF-8"?>
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
          <string>https://file.storeios.net/${fileName}</string>
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
}

// Reset endpoint
app.post('/reset', (req, res) => {
  res.json({ success: true });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
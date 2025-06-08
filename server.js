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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth endpoint (giữ nguyên)
app.post('/auth', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD } = req.body;
    const user = await Store.authenticate(APPLE_ID, PASSWORD);

    if (user.failureType?.toLowerCase().includes('mfa')) {
      return res.json({
        require2FA: true,
        message: user.customerMessage || '2FA verification required',
        dsid: user.dsPersonId
      });
    }

    if (user._state === 'success') {
      return res.json({ 
        success: true, 
        dsid: user.dsPersonId 
      });
    }

    throw new Error(user.customerMessage || 'Authentication failed');
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Verify endpoint (giữ nguyên)
app.post('/verify', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE } = req.body;
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

    if (user._state !== 'success') {
      throw new Error(user.customerMessage || 'Verification failed');
    }

    res.json({ 
      success: true,
      dsid: user.dsPersonId
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Download endpoint (tích hợp R2)
app.post('/download', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE, APPID, appVerId } = req.body;
    
    // Tạo thư mục tạm
    const tempDir = path.join(__dirname, 'temp', uuidv4());
    await fsPromises.mkdir(tempDir, { recursive: true });

    // Gọi hàm downipa gốc
    const result = await Store.download(APPID, appVerId, {
      APPLE_ID, PASSWORD, CODE,
      dsPersonId: req.body.dsid
    });

    if (result.require2FA) {
      return res.json({
        success: false,
        require2FA: true,
        message: result.message
      });
    }

    // Upload lên R2
    const fileData = await fsPromises.readFile(result.filePath);
    const r2FileName = `${result.fileName}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2FileName,
      Body: fileData,
      ContentType: 'application/octet-stream'
    }));

    // Tạo plist
    const plistContent = `<?xml version="1.0"?>
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
              <string>https://file.storeios.net/${r2FileName}</string>
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

    const plistName = `${r2FileName.split('.')[0]}.plist`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: plistName,
      Body: plistContent,
      ContentType: 'application/xml'
    }));

    // Tự động xóa sau 5 phút
    setTimeout(async () => {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: r2FileName
      }));
      await s3Client.send(new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: plistName
      }));
    }, 5 * 60 * 1000);

    // Xóa file tạm
    await fsPromises.rm(tempDir, { recursive: true, force: true });

    res.json({
      success: true,
      downloadUrl: `https://file.storeios.net/${r2FileName}`,
      installUrl: `itms-services://?action=download-manifest&url=https://file.storeios.net/${plistName}`,
      fileName: result.fileName,
      appInfo: result.appInfo
    });

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Reset endpoint
app.post('/reset', (req, res) => {
  res.json({ success: true });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
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

// Verify endpoint (GIỮ NGUYÊN từ file gốc)
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

// Download endpoint (TÍCH HỢP R2)
app.post('/download', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE, APPID, appVerId } = req.body;
    
    if (!APPLE_ID || !PASSWORD || !APPID) {
      return res.status(400).json({ 
        success: false, 
        error: 'Required fields are missing' 
      });
    }

    // Tạo thư mục tạm
    const tempDir = path.join(__dirname, 'temp', uuidv4());
    await fsPromises.mkdir(tempDir, { recursive: true });

    // Gọi hàm downipa gốc
    const result = await ipaTool.downipa({
      path: tempDir,
      APPLE_ID,
      PASSWORD,
      CODE,
      APPID,
      appVerId
    });

    // Xử lý 2FA nếu cần (GIỮ NGUYÊN từ file gốc)
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
    const plistContent = generatePlistContent(r2FileName, result.appInfo);
    const plistName = `${r2FileName.split('.')[0]}.plist`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: plistName,
      Body: plistContent,
      ContentType: 'application/xml'
    }));

    // Tự động xóa sau 5 phút
    setTimeout(async () => {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: r2FileName
        }));
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: plistName
        }));
      } catch (err) {
        console.error('Error cleaning R2:', err);
      }
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
      error: error.message || 'Download failed'
    });
  }
});

// Hàm phụ tạo plist (giữ nguyên từ code gốc)
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
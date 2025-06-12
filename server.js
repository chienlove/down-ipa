import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fsPromises } from 'fs';
import fetch from 'node-fetch';
import { Store } from './src/client.js';
import { v4 as uuidv4 } from 'uuid';
import { Agent } from 'https';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Transform } from 'stream';
import plist from 'plist';
import JSZip from 'jszip';
import { PassThrough } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 5004;

// R2 Configuration with longer timeout
const R2_PUBLIC_BASE = 'https://file.storeios.net';
const R2_ENDPOINT = 'https://b9b33e1228ae77e510897cc002c1735c.r2.cloudflarestorage.com';
const r2Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  },
  forcePathStyle: true,
  requestHandler: {
    requestTimeout: 300000 // 5 minutes
  }
});

// Enhanced upload function with retry
async function uploadToR2WithRetry(params, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const passThrough = new PassThrough();
      const uploadPromise = r2Client.send(new PutObjectCommand({
        ...params,
        Body: passThrough
      }));
      
      if (params.sourceStream) {
        params.sourceStream.pipe(passThrough);
      }
      
      return await uploadPromise;
    } catch (error) {
      lastError = error;
      console.error(`Upload attempt ${attempt + 1} failed:`, error.message);
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function deleteFromR2(key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: 'file',
      Key: key
    });
    await r2Client.send(command);
    console.log(`Successfully deleted ${key} from R2`);
  } catch (error) {
    console.error('R2 delete error:', error);
    throw error;
  }
}

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/.well-known/acme-challenge', express.static(path.join(__dirname, '.well-known', 'acme-challenge')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    version: '1.0.2',
    timestamp: new Date().toISOString()
  });
});

class SignatureTransform extends Transform {
  constructor(songList0, email) {
    super({
      highWaterMark: 5 * 1024 * 1024 // 5MB buffer
    });
    this.signature = songList0.sinfs.find(sinf => sinf.id === 0);
    if (!this.signature) throw new Error('Invalid signature.');
    
    this.metadata = { 
      ...songList0.metadata, 
      'apple-id': email, 
      userName: email, 
      'appleId': email 
    };
    
    this.chunks = [];
  }

  _transform(chunk, encoding, callback) {
    this.chunks.push(chunk);
    callback();
  }

  async _flush(callback) {
    try {
      const buffer = Buffer.concat(this.chunks);
      const zip = await JSZip.loadAsync(buffer);
      
      // Add metadata
      const metadataPlist = plist.build(this.metadata);
      zip.file('iTunesMetadata.plist', Buffer.from(metadataPlist, 'utf8'));
      
      // Find and add signature
      const manifestFile = zip.file(/\.app\/SC_Info\/Manifest\.plist$/)[0];
      if (!manifestFile) throw new Error('Invalid app bundle.');
      
      const manifestContent = await manifestFile.async('string');
      const manifest = plist.parse(manifestContent);
      const sinfPath = manifest.SinfPaths?.[0];
      if (!sinfPath) throw new Error('Invalid signature.');
      
      const appBundleName = manifestFile.name.split('/')[1].replace(/\.app$/, '');
      const signatureTargetPath = `Payload/${appBundleName}.app/${sinfPath}`;
      zip.file(signatureTargetPath, Buffer.from(this.signature.sinf, 'base64'));
      
      // Regenerate zip
      const newBuffer = await zip.generateAsync({ 
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 } // Balanced compression
      });
      
      this.push(newBuffer);
      callback();
    } catch (err) {
      callback(err);
    } finally {
      this.chunks = null; // Free memory
    }
  }
}

class IPATool {
  async downipa({ APPLE_ID, PASSWORD, CODE, APPID, appVerId }) {
    try {
      // Authentication (keep existing code)
      const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);
      if (user._state !== 'success') {
        if (user.failureType?.toLowerCase().includes('mfa')) {
          return { require2FA: true, message: user.customerMessage || '2FA verification required' };
        }
        throw new Error(user.customerMessage || 'Authentication failed');
      }

      // Get app info (keep existing code)
      const app = await Store.download(APPID, appVerId, user);
      const songList0 = app?.songList?.[0];
      if (!app || app._state !== 'success' || !songList0 || !songList0.metadata) {
        throw new Error(app?.customerMessage || 'Failed to get app information');
      }

      const appInfo = {
        name: songList0.metadata.bundleDisplayName,
        version: songList0.metadata.bundleShortVersionString,
        bundleId: songList0.metadata.softwareVersionBundleId
      };

      // Generate unique keys
      const randomId = uuidv4().substring(0, 8);
      const ipaKey = `ipas/${randomId}_${appInfo.name.replace(/[^a-z0-9]/gi, '_')}.ipa`;
      const plistKey = `manifests/${randomId}.plist`;

      // Download with timeout
      const ipaResponse = await fetch(songList0.URL, { 
        agent: new Agent({ rejectUnauthorized: false }),
        timeout: 120000 // 2 minutes
      });
      
      if (!ipaResponse.ok) throw new Error(`Failed to download IPA: ${ipaResponse.statusText}`);

      const contentLength = Number(ipaResponse.headers.get('content-length'));
      if (!contentLength || contentLength > 500 * 1024 * 1024) {
        throw new Error('Invalid file size or file too large (>500MB)');
      }

      // Process with signature
      const signatureTransform = new SignatureTransform(songList0, APPLE_ID);
      ipaResponse.body.pipe(signatureTransform);

      // Upload to R2 with retry
      await uploadToR2WithRetry({
        Bucket: 'file',
        Key: ipaKey,
        ContentType: 'application/octet-stream',
        ContentLength: contentLength,
        sourceStream: signatureTransform
      }, 3);

      // Create and upload plist
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

      await uploadToR2WithRetry({
        Bucket: 'file',
        Key: plistKey,
        Body: Buffer.from(plistContent),
        ContentType: 'application/xml'
      }, 3);

      // Schedule cleanup
      setTimeout(async () => {
        try {
          await deleteFromR2(ipaKey);
          await deleteFromR2(plistKey);
        } catch (err) {
          console.error('Cleanup error:', err.message);
        }
      }, 5 * 60 * 1000); // 5 minutes

      return {
        appInfo,
        downloadUrl: `${R2_PUBLIC_BASE}/${ipaKey}`,
        installUrl: `itms-services://?action=download-manifest&url=${encodeURIComponent(`${R2_PUBLIC_BASE}/${plistKey}`)}`,
        r2UploadSuccess: true
      };
    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }
}

const ipaTool = new IPATool();

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

app.post('/download', async (req, res) => {
  try {
    const result = await ipaTool.downipa(req.body);
    res.json({
      success: true,
      downloadUrl: result.downloadUrl,
      installUrl: result.installUrl,
      appInfo: result.appInfo
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Download failed'
    });
  }
});

// Error handling (keep existing)
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
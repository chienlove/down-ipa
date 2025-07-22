import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';
import https from 'https';
import { createWriteStream, existsSync } from 'fs';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);
const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

// Hàm xử lý URL file (Supabase Storage)
const extractFileKey = (url) => {
  try {
    let decodedUrl = decodeURIComponent(url);
    const pattern = /\/storage\/v1\/object\/public\/certificates\/(.+)/;
    const match = decodedUrl.match(pattern);
    if (match && match[1]) return match[1];
    return decodedUrl.split('certificates/').pop() || decodedUrl;
  } catch (e) {
    console.error('URL parsing error:', e);
    return url;
  }
};

// Hàm tải file từ Supabase Storage (3 lần thử)
const downloadFile = async (fileKey) => {
  let lastError;
  for (let i = 0; i < 3; i++) {
    try {
      const { data, error } = await supabase.storage
        .from('certificates')
        .download(encodeURI(fileKey));
      if (error) {
        console.error(`Lỗi tải file (lần ${i + 1}):`, error.message);
        lastError = error;
        continue;
      }
      if (data) return data;
    } catch (err) {
      lastError = err;
      console.error(`Lỗi try-catch (lần ${i + 1}):`, err.message);
    }
    if (i < 2) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw lastError || new Error('Không thể tải file sau 3 lần thử');
};

// Tải AppleWWDR cert nếu chưa có, chuyển sang PEM
const ensureAppleWWDRCert = async () => {
  const projectRoot = path.resolve(__dirname, '..'); // lên khỏi /routes
  const pemPath = path.join(projectRoot, 'AppleWWDRCAG3.pem');
  const cerPath = path.join(projectRoot, 'AppleWWDRCAG3.cer');

  if (existsSync(pemPath)) return pemPath;

  console.log('🔽 Đang tải AppleWWDRCAG3.cer từ Apple...');
  await new Promise((resolve, reject) => {
    const file = createWriteStream(cerPath);
    https.get('https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer', res => {
      if (res.statusCode !== 200) {
        reject(new Error(`Tải thất bại: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', reject);
  });

  console.log('🔄 Chuyển CER → PEM bằng OpenSSL...');
  await exec(`openssl x509 -inform der -in "${cerPath}" -out "${pemPath}"`);

  return pemPath;
};

// Đọc và trả về forge issuer cert
const loadAppleIssuer = async () => {
  const pemPath = await ensureAppleWWDRCert();
  const pem = await fs.readFile(pemPath, 'utf8');
  return forge.pki.certificateFromPem(pem);
};

// Gửi OCSP request từ cert và issuer
const checkRevocationStatus = async (cert) => {
  try {
    const issuerCert = await loadAppleIssuer();
    const ocspUrl = 'http://ocsp.apple.com/ocsp04-wwdrca';
    console.log(`⏳ Gửi OCSP đến: ${ocspUrl}`);

    const ocspRequest = forge.ocsp.createRequest({
      certificate: cert,
      issuer: issuerCert
    });

    const response = await new Promise((resolve, reject) => {
      const req = https.request(ocspUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ocsp-request',
          'Content-Length': ocspRequest.length
        },
        timeout: 10000
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('OCSP request timeout'));
      });

      req.write(ocspRequest.toDer());
      req.end();
    });

    const ocspResp = forge.ocsp.decodeResponse(response);

    if (ocspResp.status !== 'successful') {
      return {
        isRevoked: false,
        reason: `Phản hồi OCSP không thành công (mã: ${ocspResp.status})`
      };
    }

    return {
      isRevoked: ocspResp.isRevoked,
      revocationTime: ocspResp.revokedInfo?.revocationTime,
      reason: ocspResp.isRevoked
        ? `Chứng chỉ đã bị thu hồi lúc ${ocspResp.revokedInfo.revocationTime.toISOString()}`
        : 'Chứng chỉ chưa bị thu hồi'
    };

  } catch (error) {
    console.error('OCSP Error:', error.message);
    return {
      isRevoked: false,
      reason: `Không thể kiểm tra trạng thái thu hồi: ${error.message}`
    };
  }
};

// API: /check-revocation?id=...
router.get('/check-revocation', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu tham số',
        details: 'Vui lòng cung cấp ID chứng chỉ'
      });
    }

    const { data: certData, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (dbError) throw new Error(`Lỗi database: ${dbError.message}`);
    if (!certData) throw new Error(`Không tìm thấy chứng chỉ với ID: ${id}`);
    if (!certData.p12_url) throw new Error('Thiếu URL file P12');

    const fileKey = extractFileKey(certData.p12_url);
    const file = await downloadFile(fileKey);

    tempPath = path.join(__dirname, `temp_${Date.now()}_${id}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    const p12Data = await fs.readFile(tempPath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certData.password || '');

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag]?.length) {
      throw new Error('File P12 không chứa chứng chỉ hợp lệ');
    }

    const certificate = certBags[forge.pki.oids.certBag][0].cert;
    const { isRevoked, revocationTime, reason } = await checkRevocationStatus(certificate);

    res.json({
      success: true,
      name: certData.name,
      isRevoked,
      revocationTime,
      reason,
      subject: certificate.subject.attributes.reduce((acc, attr) => {
        acc[attr.name || attr.shortName] = attr.value;
        return acc;
      }, {})
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Kiểm tra thất bại',
      details: error.message
    });
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } 
      catch (e) { console.error('Lỗi khi xóa file tạm:', e.message); }
    }
  }
});

export default router;
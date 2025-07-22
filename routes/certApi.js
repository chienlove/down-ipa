import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';
import https from 'https';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Hàm kiểm tra trạng thái thu hồi qua OCSP
const checkRevocationStatus = async (cert) => {
  try {
    // Lấy URL OCSP từ chứng chỉ
    const ocspUrl = cert.authorityInfoAccess.find(access => 
      access.accessMethod === '1.3.6.1.5.5.7.48.1' // id-ad-ocsp
    ).accessLocation;

    if (!ocspUrl) {
      return { isRevoked: false, ocspSupported: false };
    }

    // Tạo OCSP Request
    const ocspRequest = forge.ocsp.createRequest({
      certificate: cert,
      issuer: cert // Giả định issuer cert đã có trong chain
    });

    // Gửi request đến máy chủ OCSP của Apple
    const response = await new Promise((resolve, reject) => {
      const req = https.request(ocspUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ocsp-request',
          'Content-Length': ocspRequest.length
        },
        timeout: 5000
      }, (res) => {
        let data = [];
        res.on('data', chunk => data.push(chunk));
        res.on('end', () => resolve(Buffer.concat(data)));
      });

      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('OCSP timeout')));
      req.write(ocspRequest.toDer());
      req.end();
    });

    const ocspResponse = forge.ocsp.decodeResponse(response);
    return {
      isRevoked: ocspResponse.isRevoked,
      revocationTime: ocspResponse.revokedInfo?.revocationTime,
      ocspSupported: true
    };

  } catch (error) {
    console.error('OCSP check error:', error.message);
    return { isRevoked: false, ocspSupported: false };
  }
};

// API Endpoint
router.get('/check', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing certificate ID' });

    // 1. Lấy thông tin từ database
    const { data: cert, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (dbError) throw dbError;
    if (!cert) throw new Error('Certificate not found');

    // 2. Tải file từ storage
    const fileKey = cert.p12_url.split('public/')[1];
    const { data: file, error: downloadError } = await supabase.storage
      .from('certificates')
      .download(fileKey);

    if (downloadError) throw downloadError;

    // 3. Lưu file tạm
    tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // 4. Đọc và kiểm tra chứng chỉ
    const p12Data = await fs.readFile(tempPath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, cert.password || '');

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag]?.length) {
      throw new Error('No certificate found in P12');
    }

    const certificate = certBags[forge.pki.oids.certBag][0].cert;
    const now = new Date();

    // Kiểm tra thời hạn
    const isExpired = now < certificate.validity.notBefore || now > certificate.validity.notAfter;

    // Kiểm tra trạng thái thu hồi
    const { isRevoked, revocationTime } = await checkRevocationStatus(certificate);

    res.json({
      success: true,
      name: cert.name,
      valid: !isExpired && !isRevoked,
      isExpired,
      isRevoked,
      revocationTime: revocationTime?.toISOString(),
      expiresAt: certificate.validity.notAfter.toISOString(),
      subject: certificate.subject.attributes.map(attr => ({
        name: attr.name,
        value: attr.value
      })),
      issuer: certificate.issuer.attributes.map(attr => ({
        name: attr.name,
        value: attr.value
      }))
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      error: 'Certificate check failed',
      details: error.message.includes('Invalid password') ? 'Wrong password' : 
               error.message.includes('No certificate found') ? 'Invalid P12 format' :
               error.message
    });
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } catch (e) { console.error('Cleanup error:', e); }
    }
  }
});

export default router;
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
  { 
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

// Hàm kiểm tra OCSP không dùng axios
const checkOCSPStatus = (cert) => {
  return new Promise((resolve) => {
    try {
      const ocspUrl = cert.authorityInfoAccess?.find(access => 
        access.accessMethod === '1.3.6.1.5.5.7.48.1'
      )?.accessLocation;

      if (!ocspUrl) {
        return resolve({ isRevoked: false, ocspSupported: false });
      }

      const ocspRequest = forge.ocsp.createRequest({ certificate: cert });
      const options = {
        method: 'POST',
        hostname: new URL(ocspUrl).hostname,
        path: new URL(ocspUrl).pathname,
        headers: {
          'Content-Type': 'application/ocsp-request',
          'Content-Length': ocspRequest.length
        },
        timeout: 5000
      };

      const req = https.request(options, (res) => {
        let data = Buffer.alloc(0);
        res.on('data', (chunk) => {
          data = Buffer.concat([data, chunk]);
        });
        res.on('end', () => {
          try {
            const ocspResponse = forge.ocsp.decodeResponse(data);
            resolve({
              isRevoked: ocspResponse.isRevoked,
              ocspSupported: true,
              revocationTime: ocspResponse.revokedInfo?.revocationTime
            });
          } catch (error) {
            resolve({ isRevoked: false, ocspSupported: false });
          }
        });
      });

      req.on('error', () => resolve({ isRevoked: false, ocspSupported: false }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ isRevoked: false, ocspSupported: false });
      });

      req.write(ocspRequest.toDer());
      req.end();

    } catch (error) {
      resolve({ isRevoked: false, ocspSupported: false });
    }
  });
};

// Hàm kiểm tra chứng chỉ
const verifyCertificate = async (filePath, password = '') => {
  try {
    const p12Data = await fs.readFile(filePath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag]?.length) {
      throw new Error('No certificate found in P12 file');
    }

    const cert = certBags[forge.pki.oids.certBag][0].cert;
    const now = new Date();
    const isExpired = now < cert.validity.notBefore || now > cert.validity.notAfter;

    // Kiểm tra OCSP
    const pemCert = forge.pki.certificateToPem(cert);
    const { isRevoked } = await checkOCSPStatus(forge.pki.certificateFromPem(pemCert));

    return {
      isValid: !isExpired && !isRevoked,
      isExpired,
      isRevoked,
      expiresAt: cert.validity.notAfter.toISOString(),
      subject: cert.subject.attributes.map(attr => ({
        name: attr.name,
        value: attr.value
      })),
      issuer: cert.issuer.attributes.map(attr => ({
        name: attr.name,
        value: attr.value
      }))
    };

  } catch (error) {
    console.error('Certificate verification error:', error);
    throw error;
  }
};

// API Endpoint
router.get('/check', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing certificate ID' });

    // Lấy thông tin từ database
    const { data: cert, error } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!cert) throw new Error('Certificate not found');
    if (!cert.p12_url) throw new Error('Missing P12 URL');

    // Tải file từ storage
    const fileKey = cert.p12_url.split('public/')[1];
    const { data: file, error: downloadError } = await supabase.storage
      .from('certificates')
      .download(fileKey);

    if (downloadError) throw downloadError;

    // Lưu file tạm
    tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // Kiểm tra chứng chỉ
    const result = await verifyCertificate(tempPath, cert.password);

    res.json({
      success: true,
      name: cert.name,
      ...result
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      error: 'Certificate check failed',
      details: error.message
    });
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } catch (e) { console.error('Cleanup error:', e); }
    }
  }
});

export default router;
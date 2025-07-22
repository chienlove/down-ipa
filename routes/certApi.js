import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';
import https from 'https';
import axios from 'axios';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// 1. Hàm kiểm tra trạng thái thu hồi qua OCSP
const checkOCSPStatus = async (certPem) => {
  try {
    const cert = forge.pki.certificateFromPem(certPem);
    const ocspUrl = cert.authorityInfoAccess?.find(access => 
      access.accessMethod === '1.3.6.1.5.5.7.48.1'
    )?.accessLocation;

    if (!ocspUrl) {
      console.warn('No OCSP URL found in certificate');
      return { isRevoked: false, ocspSupported: false };
    }

    const ocspRequest = forge.ocsp.createRequest({ certificate: cert });
    const response = await axios.post(ocspUrl, ocspRequest.toDer(), {
      headers: { 'Content-Type': 'application/ocsp-request' },
      responseType: 'arraybuffer'
    });

    const ocspResponse = forge.ocsp.decodeResponse(response.data);
    return {
      isRevoked: ocspResponse.isRevoked,
      ocspSupported: true,
      revocationTime: ocspResponse.revokedInfo?.revocationTime
    };
  } catch (error) {
    console.error('OCSP check failed:', error);
    return { isRevoked: false, ocspSupported: false };
  }
};

// 2. Hàm kiểm tra chứng chỉ toàn diện
const verifyCertificate = async (filePath, password = '') => {
  try {
    // Đọc và parse file P12
    const p12Data = await fs.readFile(filePath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

    // Lấy chứng chỉ từ P12
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag]?.length) {
      throw new Error('No certificate found in P12 file');
    }
    const cert = certBags[forge.pki.oids.certBag][0].cert;

    // Kiểm tra thời hạn
    const now = new Date();
    const isExpired = now < cert.validity.notBefore || now > cert.validity.notAfter;

    // Kiểm tra trạng thái thu hồi
    const { isRevoked, ocspSupported, revocationTime } = await checkOCSPStatus(
      forge.pki.certificateToPem(cert)
    );

    return {
      isValid: !isExpired && !isRevoked,
      isExpired,
      isRevoked,
      ocspSupported,
      revocationTime: revocationTime?.toISOString(),
      expiresAt: cert.validity.notAfter.toISOString(),
      issuedAt: cert.validity.notBefore.toISOString(),
      serialNumber: cert.serialNumber,
      subject: cert.subject.attributes.map(attr => ({
        name: attr.name,
        value: attr.value,
        type: attr.type
      })),
      issuer: cert.issuer.attributes.map(attr => ({
        name: attr.name,
        value: attr.value,
        type: attr.type
      }))
    };
  } catch (error) {
    console.error('Certificate verification failed:', error);
    throw error;
  }
};

// 3. API Endpoint
router.get('/check', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing certificate ID' });

    // Lấy thông tin chứng chỉ từ database
    const { data: cert, error } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!cert) throw new Error('Certificate not found');
    if (!cert.p12_url) throw new Error('P12 URL missing');

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
      error: 'Certificate verification failed',
      details: error.message,
      errorType: error.message.includes('Invalid password') ? 'INVALID_PASSWORD' : 
                error.message.includes('No certificate found') ? 'INVALID_P12' :
                'VERIFICATION_ERROR'
    });
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } catch (e) { console.error('Cleanup error:', e); }
    }
  }
});

export default router;
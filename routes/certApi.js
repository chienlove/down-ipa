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

// 1. Hàm kiểm tra trạng thái thu hồi (OCSP)
const checkOCSPStatus = async (cert) => {
  try {
    const ocspUrl = cert.authorityInfoAccess?.find(access => 
      access.accessMethod === '1.3.6.1.5.5.7.48.1'
    )?.accessLocation;

    if (!ocspUrl) {
      console.warn('Không tìm thấy OCSP URL trong chứng chỉ');
      return { isRevoked: false, ocspSupported: false };
    }

    const ocspRequest = forge.ocsp.createRequest({ certificate: cert });
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
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('OCSP request timeout'));
      });

      req.write(ocspRequest.toDer());
      req.end();
    });

    const ocspResponse = forge.ocsp.decodeResponse(response);
    return {
      isRevoked: ocspResponse.isRevoked,
      ocspSupported: true,
      revocationTime: ocspResponse.revokedInfo?.revocationTime
    };

  } catch (error) {
    console.error('Lỗi kiểm tra OCSP:', error.message);
    return { isRevoked: false, ocspSupported: false };
  }
};

// 2. Hàm kiểm tra chứng chỉ toàn diện
const verifyCertificate = async (filePath, password = '') => {
  try {
    // Đọc file P12
    const p12Data = await fs.readFile(filePath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password, false, ['certBag']);

    // Lấy chứng chỉ từ P12
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag]?.length) {
      throw new Error('Không tìm thấy chứng chỉ trong file P12');
    }
    const cert = certBags[forge.pki.oids.certBag][0].cert;

    // Kiểm tra thời hạn
    const now = new Date();
    const isExpired = now < cert.validity.notBefore || now > cert.validity.notAfter;

    // Kiểm tra trạng thái thu hồi (OCSP)
    const { isRevoked } = await checkOCSPStatus(cert);

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
    console.error('Lỗi kiểm tra chứng chỉ:', error);
    throw error;
  }
};

// 3. API Endpoint
router.get('/check', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ 
        success: false,
        error: 'Thiếu tham số ID',
        details: 'Vui lòng cung cấp ID chứng chỉ'
      });
    }

    // Lấy thông tin từ database
    const { data: cert, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (dbError) throw new Error(`Lỗi database: ${dbError.message}`);
    if (!cert) throw new Error('Không tìm thấy chứng chỉ');
    if (!cert.p12_url) throw new Error('Thiếu URL file P12');

    // Tải file từ storage
    const fileKey = cert.p12_url.split('public/')[1];
    const { data: file, error: downloadError } = await supabase.storage
      .from('certificates')
      .download(fileKey);

    if (downloadError) throw new Error(`Tải file thất bại: ${downloadError.message}`);

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
    console.error('API Error:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: 'Kiểm tra chứng chỉ thất bại',
      details: error.message.includes('Invalid password') ? 'Mật khẩu sai' : 
               error.message.includes('No certificate found') ? 'File P12 không hợp lệ' :
               error.message
    });
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } catch (e) { console.error('Lỗi xóa file tạm:', e); }
    }
  }
});

export default router;
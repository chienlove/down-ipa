import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';
import https from 'https';
import http from 'http';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Hàm tải file từ URL (HTTP/HTTPS)
const downloadFromUrl = (url) => {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: Không thể tải dữ liệu từ ${url}`));
      }
      const chunks = [];
      res.on('data', chunks.push.bind(chunks));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Timeout khi tải dữ liệu')));
  });
};

// Hàm tải file P12 từ Supabase
const downloadCertificateFile = async (p12Url) => {
  try {
    const fileKey = p12Url.split('public/')[1] || p12Url;
    console.log(`Đang tải file với key: ${fileKey}`);

    const { data, error } = await supabase.storage
      .from('certificates')
      .download(fileKey);

    if (error) throw new Error(`Supabase error: ${error.message}`);
    if (!data) throw new Error('Không nhận được dữ liệu file');

    return { fileData: data, fileKey };
  } catch (error) {
    console.error('Lỗi tải file:', error.message);
    throw new Error(`Tải file thất bại: ${error.message}`);
  }
};

// API kiểm tra trạng thái chứng chỉ
router.get('/check', async (req, res) => {
  let tempPath = null;
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu tham số',
        details: 'Vui lòng cung cấp ID chứng chỉ'
      });
    }

    // 1. Lấy thông tin chứng chỉ từ DB
    const { data: certData, error: dbError } = await supabase
      .from('certificates')
      .select('*')
      .eq('id', id)
      .single();

    if (dbError) throw new Error(`Lỗi truy vấn database: ${dbError.message}`);
    if (!certData) throw new Error(`Không tìm thấy chứng chỉ với ID: ${id}`);
    if (!certData.p12_url) throw new Error('Chứng chỉ thiếu URL file P12');

    // 2. Tải file P12 từ storage
    const { fileData, fileKey } = await downloadCertificateFile(certData.p12_url);
    console.log(`Tải thành công file: ${fileKey}`);

    // 3. Lưu tạm file để đọc
    tempPath = path.join(__dirname, `temp_cert_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await fileData.arrayBuffer()));

    // 4. Đọc và parse chứng chỉ từ P12
    const p12Data = await fs.readFile(tempPath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certData.password || '');

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag];
    if (!certBag || !certBag.length) {
      throw new Error('File P12 không chứa chứng chỉ hợp lệ');
    }

    const certificate = certBag[0].cert;
    const now = new Date();

    // 5. Kiểm tra thời hạn
    const isValidTime = now >= certificate.validity.notBefore && now <= certificate.validity.notAfter;
    const isExpired = now > certificate.validity.notAfter;

    // 6. Kiểm tra thu hồi (CRL)
    let isRevoked = false;
    let revocationReason = null;
    let crlCheckStatus = 'not_checked';
    let crlError = null;

    try {
      const crlExt = certificate.getExtension('cRLDistributionPoints');
      if (!crlExt) {
        crlCheckStatus = 'no_crl_dp';
      } else {
        let crlUrl = null;

        // Trích xuất URL từ CRL Distribution Points
        if (crlExt.byName && Array.isArray(crlExt.byName.fullName)) {
          const uriEntry = crlExt.byName.fullName.find(item => item.uniformResourceIdentifier);
          crlUrl = uriEntry?.uniformResourceIdentifier;
        }

        if (!crlUrl) {
          crlCheckStatus = 'no_crl_url';
        } else {
          crlCheckStatus = 'checked';
          console.log(`Tải CRL từ: ${crlUrl}`);
          const crlBuffer = await downloadFromUrl(crlUrl);

          // Parse CRL
          const asn1 = forge.asn1.fromDer(forge.util.createBuffer(crlBuffer.toString('binary')));
          const crl = forge.pki.certificateRevocationListFromAsn1(asn1);

          // Kiểm tra serial number
          const revokedEntry = crl.revoked.find(entry => entry.serialNumber === certificate.serialNumber);
          if (revokedEntry) {
            isRevoked = true;
            revocationReason = revokedEntry.reason || 'unknown';
          }
        }
      }
    } catch (err) {
      crlCheckStatus = 'error';
      crlError = err.message;
      console.warn('Lỗi khi kiểm tra CRL:', err.message);
      // Có thể chọn fail-open hoặc fail-closed tùy yêu cầu bảo mật
    }

    // 7. Trả kết quả
    res.json({
      success: true,
      name: certData.name,
      valid: isValidTime && !isRevoked,
      isExpired,
      isRevoked,
      revocation: {
        checked: crlCheckStatus === 'checked',
        status: crlCheckStatus,
        reason: revocationReason,
        error: crlError
      },
      validity: {
        notBefore: certificate.validity.notBefore.toISOString(),
        notAfter: certificate.validity.notAfter.toISOString()
      },
      subject: certificate.subject.attributes.reduce((acc, attr) => {
        acc[attr.name || attr.shortName] = attr.value;
        return acc;
      }, {}),
      issuer: certificate.issuer.attributes.reduce((acc, attr) => {
        acc[attr.name || attr.shortName] = attr.value;
        return acc;
      }, {}),
      serialNumber: certificate.serialNumber,
      fingerprint: forge.pki.getPublicKeyFingerprint(certificate.publicKey).toHex()
    });

  } catch (error) {
    console.error('Lỗi xử lý kiểm tra chứng chỉ:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: 'Kiểm tra thất bại',
      details: error.message
    });
  } finally {
    // Dọn file tạm
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
      } catch (e) {
        console.error('Lỗi khi xóa file tạm:', e.message);
      }
    }
  }
});

export default router;
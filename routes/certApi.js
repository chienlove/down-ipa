import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Cấu hình Supabase đơn giản
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// 2. Hàm tải file đáng tin cậy
const downloadCertificateFile = async (p12Url) => {
  try {
    // Lấy phần sau 'public/' trong URL
    const fileKey = p12Url.split('public/')[1] || p12Url;
    const { data, error } = await supabase.storage
      .from('certificates')
      .download(fileKey);

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Download failed:', error.message);
    throw new Error(`Không thể tải file: ${fileKey}`);
  }
};

// 3. Hàm kiểm tra trạng thái thu hồi (đơn giản hóa)
const checkCertificateRevocation = (cert) => {
  // Triển khai OCSP check ở đây (đã bỏ qua để tập trung vào flow chính)
  // Trong thực tế cần tích hợp Apple OCSP server
  return { isRevoked: false, reason: 'Chưa triển khai OCSP' };
};

// 4. API Endpoint chính
router.get('/check', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Yêu cầu ID chứng chỉ' });

    // A. Truy vấn database
    const { data: certData, error: dbError } = await supabase
      .from('certificates')
      .select('*')
      .eq('id', id)
      .single();

    if (dbError) throw new Error(`Lỗi database: ${dbError.message}`);
    if (!certData) throw new Error('Không tìm thấy chứng chỉ');

    // B. Tải file P12
    const file = await downloadCertificateFile(certData.p12_url);
    tempPath = path.join(__dirname, `temp_${id}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // C. Đọc chứng chỉ
    const p12Data = await fs.readFile(tempPath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certData.password || '');

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag]?.length) {
      throw new Error('File P12 không chứa chứng chỉ hợp lệ');
    }

    const certificate = certBags[forge.pki.oids.certBag][0].cert;
    const now = new Date();

    // D. Kiểm tra cơ bản
    const validityCheck = {
      isExpired: now > certificate.validity.notAfter,
      isValid: now >= certificate.validity.notBefore && now <= certificate.validity.notAfter
    };

    // E. Kiểm tra thu hồi (placeholder - cần triển khai thực tế)
    const revocationCheck = checkCertificateRevocation(certificate);

    // F. Kết quả
    res.json({
      success: true,
      name: certData.name,
      valid: validityCheck.isValid && !revocationCheck.isRevoked,
      isExpired: validityCheck.isExpired,
      isRevoked: revocationCheck.isRevoked,
      revocationReason: revocationCheck.reason,
      expiresAt: certificate.validity.notAfter.toISOString(),
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
      try { await fs.unlink(tempPath); } catch (e) { /* Bỏ qua lỗi xóa file */ }
    }
  }
});

export default router;
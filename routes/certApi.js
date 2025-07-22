import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Hàm tải file với xử lý lỗi chi tiết
const downloadCertificateFile = async (p12Url) => {
  try {
    // Trích xuất file key từ URL
    const fileKey = p12Url.split('public/')[1] || p12Url;
    console.log(`Đang tải file với key: ${fileKey}`);

    const { data, error } = await supabase.storage
      .from('certificates')
      .download(fileKey);

    if (error) {
      console.error('Lỗi từ Supabase:', error.message);
      throw new Error(`Không thể tải file từ storage`);
    }

    if (!data) {
      throw new Error('Không nhận được dữ liệu file');
    }

    return { fileData: data, fileKey };
  } catch (error) {
    console.error('Lỗi trong quá trình tải file:', error.message);
    throw new Error(`Tải file thất bại: ${error.message}`);
  }
};

// API Endpoint
router.get('/check', async (req, res) => {
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

    // 1. Truy vấn database
    const { data: certData, error: dbError } = await supabase
      .from('certificates')
      .select('*')
      .eq('id', id)
      .single();

    if (dbError) throw new Error(`Lỗi database: ${dbError.message}`);
    if (!certData) throw new Error(`Không tìm thấy chứng chỉ với ID: ${id}`);
    if (!certData.p12_url) throw new Error('Chứng chỉ thiếu URL file P12');

    // 2. Tải file từ storage
    const { fileData, fileKey } = await downloadCertificateFile(certData.p12_url);
    console.log(`Tải thành công file: ${fileKey}`);

    // 3. Lưu file tạm
    tempPath = path.join(__dirname, `cert_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await fileData.arrayBuffer()));

    // 4. Đọc và kiểm tra chứng chỉ
    const p12Data = await fs.readFile(tempPath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certData.password || '');

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag]?.length) {
      throw new Error('File P12 không chứa chứng chỉ hợp lệ');
    }

    const certificate = certBags[forge.pki.oids.certBag][0].cert;
    const now = new Date();
    const isValid = now >= certificate.validity.notBefore && now <= certificate.validity.notAfter;

    res.json({
      success: true,
      name: certData.name,
      valid: isValid,
      isExpired: now > certificate.validity.notAfter,
      expiresAt: certificate.validity.notAfter.toISOString(),
      subject: certificate.subject.attributes.reduce((acc, attr) => {
        acc[attr.name || attr.shortName] = attr.value;
        return acc;
      }, {})
    });

  } catch (error) {
    console.error('Lỗi trong quá trình xử lý:', {
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
    if (tempPath) {
      try { await fs.unlink(tempPath); } 
      catch (e) { console.error('Lỗi khi xóa file tạm:', e.message); }
    }
  }
});

export default router;
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình Supabase với timeout
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { 
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

// Hàm xử lý URL file (đã fix lỗi encode)
const extractFileKey = (url) => {
  try {
    // Xử lý trường hợp URL đã encode nhiều lần
    let decodedUrl = decodeURIComponent(url);
    
    // Pattern cho URL Supabase Storage
    const pattern = /\/storage\/v1\/object\/public\/certificates\/(.+)/;
    const match = decodedUrl.match(pattern);
    
    if (match && match[1]) {
      return match[1]; // Trả về phần sau 'certificates/'
    }
    
    // Fallback cho các định dạng URL khác
    return decodedUrl.split('certificates/').pop() || decodedUrl;
  } catch (e) {
    console.error('URL parsing error:', e);
    return url;
  }
};

// Hàm tải file với retry và error handling
const downloadFile = async (fileKey) => {
  let lastError;
  
  // Thử tải tối đa 3 lần
  for (let i = 0; i < 3; i++) {
    try {
      const { data, error } = await supabase.storage
        .from('certificates')
        .download(encodeURI(fileKey)); // Encode URI để xử lý ký tự đặc biệt

      if (error) {
        console.error(`Lỗi tải file (lần ${i + 1}):`, error.message);
        lastError = error;
        continue;
      }

      if (data) {
        return data;
      }
    } catch (err) {
      lastError = err;
      console.error(`Lỗi try-catch (lần ${i + 1}):`, err.message);
    }

    // Nếu không thành công, chờ 1s trước khi thử lại
    if (i < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Nếu sau 3 lần vẫn lỗi
  throw lastError || new Error('Không thể tải file sau 3 lần thử');
};

// API Endpoint với xử lý lỗi chi tiết
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

    console.log(`Bắt đầu kiểm tra chứng chỉ ID: ${id}`);

    // 1. Lấy thông tin từ database
    const { data: cert, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (dbError) {
      console.error('Lỗi database:', dbError);
      throw new Error(`Lỗi truy vấn database: ${dbError.message}`);
    }
    if (!cert) {
      throw new Error(`Không tìm thấy chứng chỉ với ID: ${id}`);
    }
    if (!cert.p12_url) {
      throw new Error('Chứng chỉ không có URL file P12');
    }

    console.log('Thông tin chứng chỉ:', {
      id: cert.id,
      name: cert.name,
      url: cert.p12_url
    });

    // 2. Trích xuất file key từ URL
    const fileKey = extractFileKey(cert.p12_url);
    console.log('File key đã trích xuất:', fileKey);

    // 3. Tải file từ storage
    const file = await downloadFile(fileKey);
    console.log('Tải file thành công, kích thước:', file.size);

    // 4. Lưu file tạm
    tempPath = path.join(__dirname, `temp_${Date.now()}_${id}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    console.log('Đã lưu file tạm tại:', tempPath);

    // 5. Kiểm tra chứng chỉ
    const p12Data = await fs.readFile(tempPath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, cert.password || '');

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag] || certBags[forge.pki.oids.certBag].length === 0) {
      throw new Error('Không tìm thấy chứng chỉ trong file P12');
    }

    const certificate = certBags[forge.pki.oids.certBag][0].cert;
    const now = new Date();
    const isValid = now >= certificate.validity.notBefore && now <= certificate.validity.notAfter;

    res.json({
      success: true,
      valid: isValid,
      expiresAt: certificate.validity.notAfter.toISOString(),
      name: cert.name,
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
    console.error('Lỗi trong quá trình xử lý:', {
      message: error.message,
      stack: error.stack,
      time: new Date().toISOString()
    });

    // Phân loại lỗi để trả về thông báo rõ ràng
    let errorDetails = error.message;
    if (error.message.includes('download')) {
      errorDetails = 'Không thể tải file từ storage. Kiểm tra lại: ' + 
                   '1. URL file có đúng không? ' + 
                   '2. Service Role Key có quyền đọc storage? ' +
                   '3. File có tồn tại trong bucket?';
    }

    res.status(500).json({
      success: false,
      error: 'Kiểm tra chứng chỉ thất bại',
      details: errorDetails
    });
  } finally {
    // Dọn dẹp file tạm nếu có
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
        console.log('Đã xóa file tạm:', tempPath);
      } catch (cleanupError) {
        console.error('Lỗi khi xóa file tạm:', cleanupError.message);
      }
    }
  }
});

export default router;
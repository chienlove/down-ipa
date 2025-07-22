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

// Cấu hình Supabase với timeout
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { 
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

// Hàm chuẩn hóa file key từ URL
const normalizeFileKey = (url) => {
  try {
    // Xử lý URL encode nhiều lần
    let decodedUrl = decodeURIComponent(url);
    
    // Pattern cho Supabase Storage URL
    const pattern = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)/;
    const match = decodedUrl.match(pattern);
    
    if (match && match[2]) {
      return match[2]; // Trả về phần path sau bucket name
    }
    
    // Fallback cho các định dạng URL khác
    return decodedUrl.split('certificates/').pop() || decodedUrl;
  } catch (e) {
    console.error('URL normalization error:', e);
    return url;
  }
};

// Hàm tải file với retry
const downloadFileWithRetry = async (fileKey, retries = 3) => {
  let lastError;
  
  for (let i = 0; i < retries; i++) {
    try {
      const { data, error } = await supabase.storage
        .from('certificates')
        .download(encodeURIComponent(fileKey));
      
      if (error) throw error;
      if (data) return data;
      
    } catch (err) {
      lastError = err;
      console.error(`Download attempt ${i + 1} failed:`, err.message);
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  
  throw lastError || new Error('Download failed after retries');
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

    // 1. Truy vấn database
    const { data: cert, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (dbError) throw new Error(`Lỗi database: ${dbError.message}`);
    if (!cert) throw new Error('Không tìm thấy chứng chỉ');
    if (!cert.p12_url) throw new Error('Thiếu URL file P12');

    console.log('Original URL:', cert.p12_url);

    // 2. Chuẩn hóa file key
    const fileKey = normalizeFileKey(cert.p12_url);
    console.log('Normalized file key:', fileKey);

    // 3. Tải file với retry
    const file = await downloadFileWithRetry(fileKey);
    
    // 4. Lưu file tạm
    tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    console.log('File saved to:', tempPath);

    // 5. Kiểm tra chứng chỉ
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

    // Phân loại lỗi cụ thể
    let errorDetails = error.message;
    if (error.message.includes('download')) {
      errorDetails = 'Không thể tải file từ storage. Kiểm tra lại URL hoặc quyền truy cập';
    }

    res.status(500).json({
      success: false,
      error: 'Kiểm tra chứng chỉ thất bại',
      details: errorDetails
    });
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } 
      catch (e) { console.error('Không thể xóa file tạm:', e); }
    }
  }
});

// Hàm kiểm tra chứng chỉ với error handling chi tiết
const verifyCertificate = async (filePath, password = '') => {
  try {
    // 1. Đọc file P12
    const p12Data = await fs.readFile(filePath).catch(err => {
      throw new Error(`Đọc file thất bại: ${err.message}`);
    });

    // 2. Giải mã P12
    let p12Asn1, p12;
    try {
      p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password, false, ['certBag']);
    } catch (err) {
      if (err.message.includes('Invalid password')) {
        throw new Error('Mật khẩu không đúng');
      }
      throw new Error(`Giải mã P12 thất bại: ${err.message}`);
    }

    // 3. Lấy chứng chỉ
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag]?.length) {
      throw new Error('Không tìm thấy chứng chỉ trong file');
    }
    const cert = certBags[forge.pki.oids.certBag][0].cert;

    // 4. Kiểm tra thời hạn
    const now = new Date();
    const isExpired = now < cert.validity.notBefore || now > cert.validity.notAfter;

    // 5. Kiểm tra trạng thái thu hồi
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
    throw error; // Chuyển tiếp lỗi với message đầy đủ
  }
};

// API endpoint với error handling chi tiết
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

    // 1. Lấy thông tin từ database
    const { data: cert, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (dbError) throw new Error(`Lỗi database: ${dbError.message}`);
    if (!cert) throw new Error('Không tìm thấy chứng chỉ');
    if (!cert.p12_url) throw new Error('Thiếu URL file P12');

    // 2. Tải file từ storage
    const fileKey = cert.p12_url.split('public/')[1] || cert.p12_url;
    const { data: file, error: downloadError } = await supabase.storage
      .from('certificates')
      .download(fileKey);

    if (downloadError) {
      throw new Error(`Tải file thất bại: ${downloadError.message}`);
    }

    // 3. Lưu file tạm
    tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // 4. Kiểm tra chứng chỉ
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
      time: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: 'Kiểm tra chứng chỉ thất bại',
      details: error.message || 'Lỗi không xác định'
    });
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } 
      catch (e) { console.error('Không thể xóa file tạm:', e); }
    }
  }
});

export default router;
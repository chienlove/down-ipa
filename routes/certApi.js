import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Khởi tạo Supabase với timeout dài hơn
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { 
    auth: { persistSession: false },
    db: { schema: 'public' },
    global: { fetch: fetchWithTimeout }
  }
);

// Hàm fetch với timeout
async function fetchWithTimeout(input, init = {}) {
  const { timeout = 30000 } = init;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(input, {
    ...init,
    signal: controller.signal  
  });
  clearTimeout(id);
  return response;
}

// Hàm extract file key từ URL Supabase Storage
const getFileKeyFromUrl = (url) => {
  try {
    // Xử lý URL có thể chứa ký tự đặc biệt như dấu phẩy
    const decodedUrl = decodeURIComponent(url);
    const urlObj = new URL(decodedUrl);
    
    // Pattern cho Supabase Storage URL
    const pattern = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)/;
    const match = urlObj.pathname.match(pattern);
    
    if (match && match[2]) {
      return match[2]; // Trả về phần path sau bucket name
    }
    return urlObj.pathname.split('public/').pop() || urlObj.pathname;
  } catch (e) {
    console.error('Error parsing URL:', url, e);
    return url;
  }
};

router.get('/check', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Thiếu ID chứng chỉ' });

    // 1. Truy vấn database - thêm timeout
    const { data: cert, error: queryError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single()
      .timeout(5000);

    if (queryError) throw new Error(`Database error: ${queryError.message}`);
    if (!cert) throw new Error('Không tìm thấy chứng chỉ');
    if (!cert.p12_url) throw new Error('Chứng chỉ thiếu URL file P12');

    console.log('Original p12_url:', cert.p12_url);

    // 2. Tải file từ storage với xử lý ký tự đặc biệt
    const fileKey = getFileKeyFromUrl(cert.p12_url);
    console.log('Extracted file key:', fileKey);

    // Tải file với 3 lần thử
    let file;
    let downloadError;
    for (let i = 0; i < 3; i++) {
      try {
        const result = await supabase.storage
          .from('certificates')
          .download(encodeURIComponent(fileKey)); // Sử dụng encodeURIComponent thay vì encodeURI
        
        file = result.data;
        downloadError = result.error;
        if (file) break;
      } catch (e) {
        downloadError = e;
        if (i === 2) throw e;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (downloadError || !file) {
      throw new Error(`Tải file thất bại sau 3 lần thử: ${downloadError?.message || 'Unknown error'}`);
    }

    // 3. Lưu file tạm với stream để xử lý file lớn
    tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // 4. Kiểm tra chứng chỉ
    const certInfo = await checkP12Certificate(tempPath, cert.password || '');
    
    res.json({
      success: true,
      valid: certInfo.valid,
      expires_at: certInfo.expiresAt,
      name: cert.name,
      subject: certInfo.subject,
      issuer: certInfo.issuer
    });

  } catch (err) {
    console.error('Full error:', {
      message: err.message,
      stack: err.stack,
      time: new Date().toISOString()
    });
    
    res.status(500).json({ 
      error: 'Kiểm tra chứng chỉ thất bại',
      details: err.message.includes('Invalid password') ? 'Sai mật khẩu' : 
               err.message.includes('Invalid PKCS#12') ? 'Định dạng file P12 không hợp lệ' :
               err.message
    });
  } finally {
    if (tempPath) {
      try { 
        await fs.unlink(tempPath).catch(e => console.error('Lỗi khi xóa file tạm:', e));
      } catch (e) {
        console.error('Lỗi xóa file tạm:', e);
      }
    }
  }
});

// Hàm kiểm tra P12 với xử lý lỗi chi tiết
const checkP12Certificate = async (filePath, password = '') => {
  try {
    // Đọc file với stream để xử lý file lớn
    const p12Data = await fs.readFile(filePath);
    
    // Chuyển đổi dữ liệu
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password, false, ['certBag']);
    
    // Lấy thông tin certificate
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag] || certBags[forge.pki.oids.certBag].length === 0) {
      throw new Error('Không tìm thấy chứng chỉ trong file P12');
    }
    
    const cert = certBags[forge.pki.oids.certBag][0].cert;
    const now = new Date();
    const valid = now >= cert.validity.notBefore && now <= cert.validity.notAfter;

    return {
      valid,
      expiresAt: cert.validity.notAfter.toISOString(),
      subject: cert.subject.attributes.map(attr => ({
        shortName: attr.shortName,
        name: attr.name,
        value: attr.value
      })),
      issuer: cert.issuer.attributes.map(attr => ({
        shortName: attr.shortName,
        name: attr.name,
        value: attr.value
      }))
    };
  } catch (err) {
    console.error('Certificate check error:', err);
    
    // Phân loại lỗi chi tiết
    if (err.message.includes('Invalid password')) {
      throw new Error('Sai mật khẩu chứng chỉ');
    } else if (err.message.includes('Invalid PKCS#12')) {
      throw new Error('Định dạng file P12 không hợp lệ');
    } else if (err.message.includes('ASN.1')) {
      throw new Error('File không phải định dạng P12 hợp lệ');
    }
    
    throw new Error(`Lỗi kiểm tra chứng chỉ: ${err.message}`);
  }
};

export default router;
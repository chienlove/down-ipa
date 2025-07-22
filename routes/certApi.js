import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình Supabase với retry
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { 
    auth: { persistSession: false },
    db: { schema: 'public' },
    global: {
      fetch: (url, options) => fetch(url, { ...options, timeout: 10000 })
    }
  }
);

// Hàm tải file mạnh mẽ với retry
const downloadFile = async (fileKey) => {
  let lastError;
  const maxRetries = 3;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Sửa lỗi encode URI cho các ký tự đặc biệt
      const encodedKey = encodeURIComponent(fileKey).replace(/%2F/g, '/');
      
      const { data, error } = await supabase.storage
        .from('certificates')
        .download(encodedKey);

      if (error) {
        lastError = new Error(`Supabase error: ${error.message}`);
        continue;
      }

      if (data) {
        return data;
      }
    } catch (err) {
      lastError = err;
    }

    // Nếu không phải lần thử cuối thì chờ 1s
    if (i < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  throw lastError || new Error(`Failed to download after ${maxRetries} attempts`);
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

    // 1. Lấy thông tin từ database
    const { data: cert, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (dbError) throw new Error(`Database error: ${dbError.message}`);
    if (!cert) throw new Error('Không tìm thấy chứng chỉ');
    if (!cert.p12_url) throw new Error('Thiếu URL file P12');

    // 2. Trích xuất file key (xử lý cả URL encoded và không encoded)
    let fileKey = cert.p12_url;
    try {
      const urlObj = new URL(cert.p12_url);
      fileKey = urlObj.pathname.split('public/')[1] || urlObj.pathname.slice(1);
    } catch {
      fileKey = cert.p12_url.split('public/')[1] || cert.p12_url;
    }

    console.log('Attempting to download:', fileKey);

    // 3. Tải file với retry
    const file = await downloadFile(fileKey);
    
    // 4. Lưu file tạm
    tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // 5. Kiểm tra chứng chỉ (giữ nguyên phần này từ code trước)
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
    console.error('Full error details:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: 'Kiểm tra chứng chỉ thất bại',
      details: error.message || 'Lỗi không xác định'
    });
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } 
      catch (e) { console.error('Không thể xóa file tạm:', e.message); }
    }
  }
});

export default router;
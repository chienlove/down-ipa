import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Khởi tạo Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { 
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

// Hàm extract file key từ URL Supabase Storage
const getFileKeyFromUrl = (url) => {
  try {
    const urlObj = new URL(url);
    // Xử lý URL dạng: https://xxx.supabase.co/storage/v1/object/public/certificates/filename.p12
    const parts = urlObj.pathname.split('/');
    if (parts.length >= 6 && parts[3] === 'object') {
      return parts.slice(5).join('/'); // Lấy phần sau 'public/certificates/'
    }
    return urlObj.pathname.split('public/')[1] || urlObj.pathname;
  } catch (e) {
    console.error('Error parsing URL:', url, e);
    return url; // Fallback to full path if URL parsing fails
  }
};

router.get('/check', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Thiếu ID chứng chỉ' });

    // 1. Truy vấn database
    const { data: cert, error: queryError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (queryError) throw queryError;
    if (!cert) throw new Error('Không tìm thấy chứng chỉ');
    if (!cert.p12_url) throw new Error('Chứng chỉ thiếu URL file P12');

    console.log('Original p12_url:', cert.p12_url); // Debug log

    // 2. Tải file từ storage
    const fileKey = getFileKeyFromUrl(cert.p12_url);
    console.log('Extracted file key:', fileKey); // Debug log

    const { data: file, error: downloadError } = await supabase
      .storage
      .from('certificates') // Đảm bảo đúng bucket name
      .download(encodeURI(fileKey)); // Encode URI để xử lý ký tự đặc biệt

    if (downloadError) {
      console.error('Download error details:', downloadError); // Debug log
      throw new Error(`Tải file thất bại: ${downloadError.message}`);
    }

    // 3. Lưu file tạm
    tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // 4. Kiểm tra chứng chỉ
    const certInfo = await checkP12Certificate(tempPath, cert.password || '');
    
    res.json({
      success: true,
      valid: certInfo.valid,
      expires_at: certInfo.expiresAt,
      name: cert.name,
      subject: certInfo.subject
    });

  } catch (err) {
    console.error('Full error stack:', err); // Log đầy đủ lỗi
    res.status(500).json({ 
      error: 'Kiểm tra chứng chỉ thất bại',
      details: err.message 
    });
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } 
      catch (e) { console.error('Lỗi xóa file tạm:', e); }
    }
  }
});

// Hàm kiểm tra P12 giữ nguyên từ file certChecker.js
const checkP12Certificate = async (filePath, password = '') => {
  try {
    const p12Data = await fs.readFile(filePath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag] || certBags[forge.pki.oids.certBag].length === 0) {
      throw new Error('No certificate found in P12 file');
    }
    
    const cert = certBags[forge.pki.oids.certBag][0].cert;
    const now = new Date();
    const valid = now >= cert.validity.notBefore && now <= cert.validity.notAfter;

    return {
      valid,
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
  } catch (err) {
    console.error('Certificate check error:', err);
    
    let errorMessage = 'Invalid certificate';
    if (err.message.includes('Invalid password')) {
      errorMessage = 'Wrong password';
    } else if (err.message.includes('Invalid PKCS#12')) {
      errorMessage = 'Invalid P12 file format';
    }
    
    throw new Error(errorMessage);
  }
};

export default router;
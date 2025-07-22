import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Cấu hình Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { 
    auth: { persistSession: false },
    db: { 
      schema: 'public',
      fetch: fetchWithTimeout // Sử dụng custom fetch
    }
  }
);

// Hàm fetch với timeout
async function fetchWithTimeout(input, init = {}) {
  const { timeout = 10000 } = init;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal  
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// 2. Hàm xử lý URL
const normalizeFileKey = (url) => {
  try {
    // Fix các URL bị encode nhiều lần
    let decodedUrl = decodeURIComponent(url);
    decodedUrl = decodedUrl.replace(/(%[0-9A-F]{2})+/g, match => 
      match === '%2C' ? ',' : match // Giữ lại dấu phẩy
    );

    // Xử lý cả URL dạng full và short
    const publicPrefix = '/storage/v1/object/public/';
    const publicIndex = decodedUrl.indexOf(publicPrefix);
    
    if (publicIndex > -1) {
      return decodedUrl.slice(publicIndex + publicPrefix.length).split('/').slice(1).join('/');
    }
    return decodedUrl.split('certificates/').pop() || decodedUrl;
  } catch (e) {
    console.error('URL normalization error:', e);
    return url;
  }
};

// 3. Hàm truy vấn certificate với timeout
const getCertificateFromDB = async (id) => {
  try {
    const { data, error } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .maybeSingle(); // Sử dụng maybeSingle thay vì single
    
    if (error) throw error;
    if (!data) throw new Error('Certificate not found');
    if (!data.p12_url) throw new Error('Missing P12 URL');
    
    return data;
  } catch (err) {
    console.error('Database query error:', err);
    throw new Error(`Database error: ${err.message}`);
  }
};

// 4. Hàm tải file từ Storage với retry
const downloadFileWithRetry = async (fileKey, retries = 3) => {
  let lastError;
  
  for (let i = 0; i < retries; i++) {
    try {
      const { data, error } = await supabase.storage
        .from('certificates')
        .download(fileKey);
      
      if (error) throw error;
      if (data) return data;
      
    } catch (err) {
      lastError = err;
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  
  throw lastError || new Error('Download failed after retries');
};

// 5. API Endpoint
router.get('/check', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing certificate ID' });

    // Bước 1: Lấy thông tin từ database
    const cert = await getCertificateFromDB(id);
    console.log('Certificate data:', { 
      id: cert.id, 
      name: cert.name,
      url: cert.p12_url 
    });

    // Bước 2: Chuẩn hóa file key
    const fileKey = normalizeFileKey(cert.p12_url);
    console.log('Normalized file key:', fileKey);

    // Bước 3: Tải file với retry
    const file = await downloadFileWithRetry(fileKey);
    
    // Bước 4: Lưu file tạm
    tempPath = path.join(__dirname, `temp_${Date.now()}_${id}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    console.log('File saved to:', tempPath);

    // Bước 5: Kiểm tra chứng chỉ
    const certInfo = await checkP12Certificate(tempPath, cert.password || '');
    console.log('Certificate info:', {
      valid: certInfo.valid,
      expiresAt: certInfo.expiresAt
    });

    res.json({
      success: true,
      valid: certInfo.valid,
      expires_at: certInfo.expiresAt,
      name: cert.name,
      subject: certInfo.subject,
      issuer: certInfo.issuer
    });

  } catch (err) {
    console.error('API Error:', {
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });

    const errorMap = {
      'Invalid password': 'Wrong password',
      'Invalid PKCS#12': 'Invalid P12 format',
      'Certificate not found': 'Certificate not found',
      'Missing P12 URL': 'Missing P12 URL'
    };

    res.status(500).json({
      error: 'Certificate check failed',
      details: errorMap[err.message] || err.message
    });
  } finally {
    if (tempPath) {
      try {
        await fs.unlink(tempPath).catch(console.error);
      } catch (e) {
        console.error('Temp file cleanup error:', e);
      }
    }
  }
});

// 6. Hàm kiểm tra P12
const checkP12Certificate = async (filePath, password = '') => {
  try {
    const p12Data = await fs.readFile(filePath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    
    // Thêm option để bỏ qua các bag không cần thiết
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password, false, [
      forge.pki.oids.certBag
    ]);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag]?.length) {
      throw new Error('No certificates found in P12');
    }

    const cert = certBags[forge.pki.oids.certBag][0].cert;
    const now = new Date();
    const valid = now >= cert.validity.notBefore && now <= cert.validity.notAfter;

    return {
      valid,
      expiresAt: cert.validity.notAfter.toISOString(),
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

  } catch (err) {
    console.error('P12 Validation Error:', err);
    
    if (err.message.includes('Invalid password')) {
      throw new Error('Invalid password');
    } else if (err.message.includes('Invalid PKCS#12')) {
      throw new Error('Invalid PKCS#12');
    } else if (err.message.includes('ASN.1')) {
      throw new Error('Invalid file format');
    }
    
    throw new Error(`Certificate validation failed: ${err.message}`);
  }
};

export default router;
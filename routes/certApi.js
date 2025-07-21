import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Khởi tạo Supabase với error handling
let supabase;
try {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { 
      auth: { persistSession: false },
      db: { schema: 'public' }
    }
  );
} catch (err) {
  console.error('Khởi tạo Supabase thất bại:', err);
  process.exit(1);
}

const checkP12Certificate = async (filePath, password = '') => {
  try {
    const p12Data = await fs.readFile(filePath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const cert = certBags[forge.pki.oids.certBag][0].cert;
    
    const now = new Date();
    const valid = now >= cert.validity.notBefore && now <= cert.validity.notAfter;

    return {
      valid,
      expiresAt: cert.validity.notAfter.toISOString(),
      subject: cert.subject.attributes.map(a => `${a.name}=${a.value}`).join(', ')
    };
  } catch (err) {
    console.error('Lỗi kiểm tra chứng chỉ:', err);
    throw new Error(err.message.includes('Invalid password') ? 
      'Sai mật khẩu' : 'Định dạng P12 không hợp lệ');
  }
};

router.get('/check', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Thiếu ID chứng chỉ' });

    // 1. Truy vấn database
    const { data: cert, error } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (error || !cert) throw new Error(error?.message || 'Không tìm thấy chứng chỉ');

    // 2. Tải file từ storage
    const fileKey = new URL(cert.p12_url).pathname.split('/public/')[1];
    const { data: file, error: downloadError } = await supabase
      .storage
      .from('certificates')
      .download(fileKey);

    if (downloadError) throw new Error('Tải file thất bại: ' + downloadError.message);

    // 3. Lưu file tạm
    tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // 4. Kiểm tra chứng chỉ
    const certInfo = await checkP12Certificate(tempPath, cert.password);
    
    res.json({
      success: true,
      valid: certInfo.valid,
      expires_at: certInfo.expiresAt,
      name: cert.name
    });

  } catch (err) {
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

export default router;
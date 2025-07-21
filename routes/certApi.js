import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkP12Certificate } from '../utils/certChecker.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

router.get('/check', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing certificate ID' });

    // 1. Truy vấn database
    const { data: cert, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (dbError || !cert) {
      console.error('Database error:', dbError);
      return res.status(404).json({ error: 'Certificate not found' });
    }

    // 2. Tải file từ storage
    const p12Url = new URL(cert.p12_url);
    const filePath = p12Url.pathname.split('/public/')[1];
    console.log('Downloading file from path:', filePath);

    const { data: file, error: downloadError } = await supabase
      .storage
      .from('certificates')
      .download(filePath);

    if (downloadError) {
      console.error('Download error:', downloadError);
      throw new Error('Failed to download certificate file');
    }

    // 3. Lưu file tạm
    tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // 4. Kiểm tra chứng chỉ
    const certInfo = await checkP12Certificate(tempPath, cert.password);
    
    // 5. Trả kết quả
    res.json({
      success: true,
      valid: certInfo.valid,
      expires_at: certInfo.expiresAt,
      certificate_name: cert.name,
      details: {
        subject: certInfo.subject,
        issuer: certInfo.issuer
      }
    });

  } catch (err) {
    console.error('Full error:', err);
    res.status(500).json({ 
      error: 'Certificate check failed',
      details: err.message || 'Unknown error' 
    });
  } finally {
    // 6. Dọn dẹp file tạm nếu tồn tại
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
      } catch (cleanupErr) {
        console.error('Cleanup error:', cleanupErr);
      }
    }
  }
});

export default router;
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
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing certificate ID' });

    // 1. Truy vấn database - CHỈ LẤY CÁC CỘT CÓ TRONG BẢNG
    const { data: cert, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, provision_url, password, created_at')
      .eq('id', id)
      .single();

    if (dbError || !cert) {
      throw new Error(dbError?.message || 'Certificate not found');
    }

    // 2. Tải file từ storage
    const filePath = new URL(cert.p12_url).pathname.split('/public/')[1];
    const { data: file, error: downloadError } = await supabase
      .storage
      .from('certificates')
      .download(filePath);

    if (downloadError) throw downloadError;

    // 3. Kiểm tra chứng chỉ
    const tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    const certInfo = await checkP12Certificate(tempPath, cert.password);
    await fs.unlink(tempPath);

    // 4. Trả kết quả (KHÔNG bao gồm provision_expires_at)
    res.json({
      valid: certInfo.valid,
      expires_at: certInfo.expiresAt,
      certificate_info: {
        id: cert.id,
        name: cert.name,
        created_at: cert.created_at,
        provision_url: cert.provision_url
      },
      message: certInfo.valid ? 'Certificate is valid' : 'Certificate has expired'
    });

  } catch (err) {
    console.error(`[CERT ERROR] ${err.message}`);
    res.status(500).json({ 
      error: 'Certificate check failed',
      details: err.message 
    });
  }
});

export default router;
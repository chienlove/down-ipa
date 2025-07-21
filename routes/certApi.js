import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

router.get('/check', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing certificate ID' });

    // 1. Truy vấn database
    const { data: cert, error: dbError } = await supabase
      .from('certificates')
      .select('p12_url, password, provision_expires_at')
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

    // 3. Lưu file tạm và kiểm tra
    const tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    
    // Giả lập kết quả kiểm tra (thay bằng hàm thực tế của bạn)
    const certInfo = {
      valid: true,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      details: { issuer: 'Test Issuer' }
    };

    await fs.unlink(tempPath);
    
    res.json({
      valid: certInfo.valid,
      expires_at: certInfo.expiresAt,
      provision_expires_at: cert.provision_expires_at
    });

  } catch (err) {
    console.error('Certificate check error:', err);
    res.status(500).json({ 
      error: 'Certificate check failed',
      details: err.message 
    });
  }
});

export default router;
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import { checkP12Certificate } from '../utils/certChecker.js';

const router = Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Middleware kiểm tra API key
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

router.get('/check', apiKeyAuth, async (req, res) => {
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

    // 3. Kiểm tra chứng chỉ
    const tempPath = `/tmp/${Date.now()}.p12`;
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    const certInfo = await checkP12Certificate(tempPath, cert.password);
    await fs.unlink(tempPath);

    // 4. Trả kết quả
    res.json({
      valid: certInfo.valid,
      expires_at: certInfo.expiresAt,
      provision_expires_at: cert.provision_expires_at,
      details: certInfo.details || null
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
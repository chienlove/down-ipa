// routes/certApi.js
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkP12Certificate } from '../utils/certChecker.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tối ưu Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    db: { schema: 'public' },
    auth: { persistSession: false },
    global: { 
      headers: { 'X-Client-Info': 'cert-api' },
      timeout: 20000 // 20 giây
    }
  }
);

// Phiên bản non-blocking
router.get('/check-cert', async (req, res) => {
  try {
    // 1. Validate input (nhanh)
    const { id, name } = req.query;
    if (!id && !name) {
      return res.status(400).json({ error: 'Require id or name' });
    }

    // 2. Truy vấn database (tối ưu)
    const { data: certData, error: dbError } = await supabase
      .from('certificates')
      .select('p12_url, password, provision_expires_at')
      .eq(id ? 'id' : 'name', id || name)
      .single()
      .timeout(5000); // Timeout riêng cho database

    if (dbError || !certData) {
      throw new Error(dbError?.message || 'Certificate not found');
    }

    // 3. Tải file stream (không dùng buffer)
    const fileKey = new URL(certData.p12_url).pathname
      .split('/public/')[1]
      .replace(/\/+/g, '/');

    console.time('DownloadFile');
    const { data: fileStream, error: downloadError } = await supabase
      .storage
      .from('certificates')
      .download(fileKey);
    console.timeEnd('DownloadFile');

    if (downloadError) {
      throw new Error(`Download failed: ${downloadError.message}`);
    }

    // 4. Xử lý file tạm (nhanh)
    const tempPath = `/tmp/cert_${Date.now()}.p12`;
    await fs.writeFile(tempPath, Buffer.from(await fileStream.arrayBuffer()));

    // 5. Kiểm tra chứng chỉ (cần tối ưu hàm này)
    console.time('CheckCertificate');
    const certInfo = await checkP12Certificate(tempPath, certData.password);
    console.timeEnd('CheckCertificate');

    // 6. Dọn dẹp (bất đồng bộ)
    fs.unlink(tempPath).catch(console.error);

    // 7. Trả kết quả
    res.json({
      valid: certInfo.valid,
      expires_at: certInfo.expiresAt,
      provision: certData.provision_expires_at,
      processing_time: `${console.timers?.CheckCertificate}ms` // Log thời gian
    });

  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    res.status(500).json({ 
      error: 'Process failed',
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});
// app.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const app = express();
const PORT = process.env.PORT || 3000;

// Đường dẫn __dirname trong ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Khởi tạo Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Import hàm kiểm tra
const { checkP12Certificate } = await import('./utils/certChecker.js');

// Route kiểm tra chứng chỉ theo ID hoặc NAME
app.get('/check-cert', async (req, res) => {
  const { id, name } = req.query;

  if (!id && !name) {
    return res.status(400).json({ error: 'Missing id or name parameter' });
  }

  try {
    // Lấy thông tin chứng chỉ từ bảng certificates
    let {  certData, error: certError } = id
      ? await supabase.from('certificates').select('*').eq('id', id).single()
      : await supabase.from('certificates').select('*').eq('name', name).single();

    if (certError || !certData) {
      return res.status(404).json({ error: 'Certificate not found in database' });
    }

    const certPath = path.join(__dirname, 'temp.p12');

    // Tải file .p12 từ Supabase Storage
    const p12Path = certData.p12_url.split('/').slice(2).join('/');
    const { data, error } = await supabase.storage.from(p12Path).download();

    if (error) {
      return res.status(500).json({ error: 'Failed to download certificate' });
    }

    const buffer = await data.arrayBuffer();
    fs.writeFileSync(certPath, Buffer.from(buffer));

    // Kiểm tra .p12
    const certInfo = await checkP12Certificate(certPath, certData.password);

    // Xóa file tạm
    fs.unlinkSync(certPath);

    return res.json({
      certificate: certInfo,
      provision_expires_at: certData.provision_expires_at || null,
      message: certInfo.valid ? 'Certificate is valid' : 'Certificate has expired',
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Certificate checker API running on port ${PORT}`);
});
// app.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const app = express;
const PORT = process.env.PORT || 3000;

// Xử lý __dirname trong ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Đường dẫn file tạm
const certPath = path.join(__dirname, 'temp.p12');

// Khởi tạo Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Hàm kiểm tra .p12
function checkP12Certificate(certPath, password = '') {
  return new Promise((resolve, reject) => {
    const pass = password ? `-passin pass:${password}` : '-passin pass:';
    const command = `openssl pkcs12 -info -in "${certPath}" ${pass}`;

    exec(command, (err, stdout, stderr) => {
      if (err || stderr.includes('MAC verify failure')) {
        return reject(new Error('Invalid password or corrupted file'));
      }

      const notAfterMatch = stdout.match(/Not After *: ([\w\s:]+)/);
      const issuerMatch = stdout.match(/Issuer.*?CN=([^,]+)/);

      if (!notAfterMatch) {
        return reject(new Error('Could not parse certificate expiry date'));
      }

      const expiresAt = new Date(notAfterMatch[1].trim());
      const now = new Date();
      const valid = expiresAt > now;

      resolve({
        valid,
        expiresAt: expiresAt.toISOString(),
        issuer: issuerMatch ? issuerMatch[1].trim() : null,
        message: valid ? 'Certificate is valid' : 'Certificate has expired'
      });
    });
  });
}

// Route kiểm tra chứng chỉ
app.get('/check-cert', async (req, res) => {
  const { id, name } = req.query;

  if (!id && !name) {
    return res.status(400).json({ error: 'Missing id or name parameter' });
  }

  try {
    // Lấy thông tin chứng chỉ từ bảng certificates
    let { data: certData, error: certError } = id
      ? await supabase.from('certificates').select('*').eq('id', id).single()
      : await supabase.from('certificates').select('*').eq('name', name).single();

    if (certError || !certData) {
      return res.status(404).json({ error: 'Certificate not found in database' });
    }

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
      provision_expires_at: certData.provision_expires_at || null
    });

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Khởi động server
app.listen(PORT, () => {
  console.log(`✅ Certificate checker API running on port ${PORT}`);
});
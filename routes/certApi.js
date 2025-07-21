// routes/certApi.js
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { checkP12Certificate } from '../utils/certChecker.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.get('/check-cert', async (req, res) => {
  const { id, name } = req.query;

  if (!id && !name) {
    return res.status(400).json({ error: 'Missing id or name parameter' });
  }

  try {
    console.log(`Fetching certificate with ${id ? 'id' : 'name'}:`, id || name);
    
    let query = supabase.from('certificates').select('*');
    query = id ? query.eq('id', id) : query.eq('name', name);
    const { data: certData, error: certError } = await query.single();

    if (certError) {
      console.error('Database error:', certError);
      return res.status(404).json({ error: 'Certificate not found in database' });
    }

    if (!certData) {
      console.error('Certificate not found');
      return res.status(404).json({ error: 'Certificate not found' });
    }

    console.log('Found certificate:', certData.name);
    console.log('P12 URL:', certData.p12_url);

    const certPath = path.join(__dirname, 'temp.p12');

    // Phân tích URL và lấy đường dẫn file
    try {
      const p12Url = new URL(certData.p12_url);
      const filePath = p12Url.pathname.split('/public/')[1];
      console.log('Extracted file path:', filePath);

      // Tải file từ storage
      console.log('Attempting to download from bucket: certificates');
      const { data: fileData, error: downloadError } = await supabase
        .storage
        .from('certificates')
        .download(filePath);

      if (downloadError) {
        console.error('Download error:', downloadError);
        return res.status(500).json({ 
          error: 'Failed to download certificate',
          details: downloadError.message 
        });
      }

      if (!fileData) {
        console.error('No file data received');
        return res.status(500).json({ error: 'Empty file data' });
      }

      // Lưu file tạm
      const buffer = await fileData.arrayBuffer();
      fs.writeFileSync(certPath, Buffer.from(buffer));
      console.log('File saved temporarily at:', certPath);

      // Kiểm tra chứng chỉ
      const certInfo = await checkP12Certificate(certPath, certData.password);
      console.log('Certificate check result:', certInfo);

      // Dọn dẹp
      fs.unlinkSync(certPath);

      return res.json({
        certificate: certInfo,
        provision_expires_at: certData.provision_expires_at || null,
        message: certInfo.valid ? 'Certificate is valid' : 'Certificate has expired',
      });

    } catch (parseError) {
      console.error('URL parsing error:', parseError);
      return res.status(500).json({ 
        error: 'Invalid certificate URL',
        details: parseError.message 
      });
    }

  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    });
  }
});

export default router;
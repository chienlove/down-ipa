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
    return res.status(400).json({ 
      error: 'Missing parameter',
      details: 'Please provide either id or name' 
    });
  }

  try {
    // 1. Truy vấn database
    const query = id 
      ? supabase.from('certificates').select('*').eq('id', id)
      : supabase.from('certificates').select('*').eq('name', name);
    
    const { data: certData, error: dbError } = await query.single();

    if (dbError || !certData) {
      console.error('Database error:', dbError || 'No data found');
      return res.status(404).json({ 
        error: 'Certificate not found',
        details: dbError?.message || 'No matching record' 
      });
    }

    // 2. Chuẩn hóa đường dẫn file
    const urlObj = new URL(certData.p12_url);
    const fullPath = urlObj.pathname;
    
    // Xử lý các vấn đề về path:
    // - Loại bỏ slash thừa
    // - Encode các ký tự đặc biệt
    const normalizedPath = fullPath
      .replace(/\/{2,}/g, '/') // Thay thế nhiều slash bằng một
      .split('/')
      .filter(part => part.trim() !== '')
      .map(encodeURIComponent)
      .join('/');

    const bucketName = 'certificates';
    const filePath = normalizedPath.split(`${bucketName}/`)[1];

    if (!filePath) {
      console.error('Invalid path structure:', fullPath);
      return res.status(500).json({
        error: 'Invalid file path',
        details: `Cannot extract path from: ${fullPath}`
      });
    }

    console.log(`Downloading from: ${bucketName}/${filePath}`);

    // 3. Tải file từ storage
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from(bucketName)
      .download(filePath);

    if (downloadError || !fileData) {
      console.error('Download failed:', {
        error: downloadError,
        attemptedPath: `${bucketName}/${filePath}`
      });
      return res.status(500).json({ 
        error: 'Failed to download certificate',
        details: downloadError?.message || 'File data empty'
      });
    }

    // 4. Lưu file tạm và kiểm tra
    const tempFilePath = path.join(__dirname, `temp_${Date.now()}.p12`);
    try {
      await fs.promises.writeFile(
        tempFilePath, 
        Buffer.from(await fileData.arrayBuffer())
      );

      const certInfo = await checkP12Certificate(tempFilePath, certData.password);
      
      // 5. Dọn dẹp và trả kết quả
      fs.unlinkSync(tempFilePath);

      return res.json({
        success: true,
        valid: certInfo.valid,
        expires_at: certInfo.expiresAt,
        provision_expires_at: certData.provision_expires_at,
        message: certInfo.valid 
          ? 'Certificate is valid' 
          : 'Certificate has expired'
      });

    } catch (fileError) {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      console.error('File processing error:', fileError);
      return res.status(500).json({
        error: 'Certificate processing failed',
        details: fileError.message
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
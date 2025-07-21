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
    let { data: certData, error: certError } = id
      ? await supabase.from('certificates').select('*').eq('id', id).single()
      : await supabase.from('certificates').select('*').eq('name', name).single();

    if (certError || !certData) {
      return res.status(404).json({ error: 'Certificate not found in database' });
    }

    const certPath = path.join(__dirname, 'temp.p12');

    // Extract the file path from the full URL
    const p12Url = new URL(certData.p12_url);
    const filePath = p12Url.pathname.split('/public/')[1];
    
    // Download the file from the correct bucket
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from('certificates')
      .download(filePath);

    if (downloadError || !fileData) {
      return res.status(500).json({ error: 'Failed to download certificate' });
    }

    // Save the file temporarily
    const buffer = await fileData.arrayBuffer();
    fs.writeFileSync(certPath, Buffer.from(buffer));

    // Check the certificate
    const certInfo = await checkP12Certificate(certPath, certData.password);

    // Clean up
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

export default router;
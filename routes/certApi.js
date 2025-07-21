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

    const p12Path = certData.p12_url.split('/').slice(2).join('/');
    const { data, error } = await supabase.storage.from(p12Path).download();

    if (error) {
      return res.status(500).json({ error: 'Failed to download certificate' });
    }

    const buffer = await data.arrayBuffer();
    fs.writeFileSync(certPath, Buffer.from(buffer));

    const certInfo = await checkP12Certificate(certPath, certData.password);

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
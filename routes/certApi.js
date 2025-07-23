import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';
import https from 'https';
import { createWriteStream, existsSync } from 'fs';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);
const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

const extractFileKey = (url) => {
  try {
    const decodedUrl = decodeURIComponent(url);
    const pattern = /\/storage\/v1\/object\/public\/certificates\/(.+)/;
    const match = decodedUrl.match(pattern);
    return match?.[1] || decodedUrl.split('certificates/').pop() || decodedUrl;
  } catch (e) {
    console.error('URL parsing error:', e);
    return url;
  }
};

const downloadFile = async (fileKey) => {
  for (let i = 0; i < 3; i++) {
    try {
      const { data, error } = await supabase.storage
        .from('certificates')
        .download(encodeURIComponent(fileKey));
      if (error) throw error;
      return data;
    } catch (err) {
      if (i === 2) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
};

const ensureAppleWWDRCert = async () => {
  const pemPath = '/tmp/AppleWWDRCAG3.pem';
  if (existsSync(pemPath)) return pemPath;

  const cerPath = '/tmp/AppleWWDRCAG3.cer';
  await new Promise((resolve, reject) => {
    const file = createWriteStream(cerPath);
    https.get('https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer', res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });

  await exec(`openssl x509 -inform der -in "${cerPath}" -out "${pemPath}"`);
  return pemPath;
};

const extractCertificateInfo = async (p12Path, password) => {
  const certPem = `/tmp/cert_${Date.now()}.pem`;
  await exec(`openssl pkcs12 -in "${p12Path}" -clcerts -nokeys -passin pass:${password} -out "${certPem}"`);
  return certPem;
};

const checkOCSPWithOpenSSL = async (certPem, issuerPem) => {
  try {
    const cmd = `openssl ocsp -issuer "${issuerPem}" -cert "${certPem}" -url http://ocsp.apple.com/ocsp04-wwdrca -noverify -resp_text`;
    const { stdout } = await exec(cmd);

    const isRevoked = stdout.includes('Revocation Time');
    const matchTime = stdout.match(/Revocation Time: (.+)/);
    const revocationTime = matchTime ? new Date(matchTime[1]).toISOString() : null;

    return {
      isRevoked,
      revocationTime,
      reason: isRevoked ? `Revoked at ${revocationTime}` : 'Valid certificate',
      ocspStatus: 'successful'
    };
  } catch (err) {
    return {
      isRevoked: false,
      reason: `OCSP check failed: ${err.message}`,
      ocspStatus: 'error'
    };
  }
};

router.get('/check-revocation', async (req, res) => {
  let tempPath, certPemPath;
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing certificate ID' });

    const { data: certData, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (dbError) throw new Error(`Database error: ${dbError.message}`);
    if (!certData?.p12_url) throw new Error('Missing P12 file URL');

    const fileKey = extractFileKey(certData.p12_url);
    const file = await downloadFile(fileKey);

    tempPath = path.join(__dirname, `temp_${Date.now()}_${id}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // Extract cert PEM
    certPemPath = await extractCertificateInfo(tempPath, certData.password || '');

    // Load Apple WWDR PEM
    const issuerPem = await ensureAppleWWDRCert();

    // OCSP Check
    const result = await checkOCSPWithOpenSSL(certPemPath, issuerPem);

    // Extract subject info
    const cert = forge.pki.certificateFromPem(await fs.readFile(certPemPath, 'utf8'));
    const subject = cert.subject.attributes.reduce((acc, attr) => {
      acc[attr.name || attr.shortName] = attr.value;
      return acc;
    }, {});

    res.json({
      success: true,
      name: certData.name,
      ...result,
      subject
    });

  } catch (error) {
    console.error('API Error:', {
      message: error.message,
      stack: error.stack,
      query: req.query
    });
    res.status(500).json({
      success: false,
      error: error.message,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  } finally {
    try { if (tempPath) await fs.unlink(tempPath); } catch (e) {}
    try { if (certPemPath) await fs.unlink(certPemPath); } catch (e) {}
  }
});

export default router;
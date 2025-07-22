import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';
import patchOCSP from '../lib/forge.ocsp.min.js';
patchOCSP(forge);
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

const loadAppleIssuer = async () => {
  const pemPath = await ensureAppleWWDRCert();
  const pem = await fs.readFile(pemPath, 'utf8');
  const cert = forge.pki.certificateFromPem(pem);
  
  // Enhanced issuer certificate validation
  if (!cert.publicKey || !cert.publicKey.subjectPublicKeyInfo) {
    const certDetails = {
      serialNumber: cert.serialNumber,
      issuer: cert.issuer.attributes.map(a => `${a.name || a.shortName}=${a.value}`),
      publicKey: {
        algorithm: cert.publicKey?.algorithm,
        exists: !!cert.publicKey
      }
    };
    console.error('Invalid Apple WWDR Certificate:', certDetails);
    throw new Error('Apple WWDR certificate has invalid public key structure');
  }

  return cert;
};

const validateCertificateStructure = (cert) => {
  if (!cert || typeof cert !== 'object') {
    throw new Error('Invalid certificate: Not an object');
  }

  if (!cert.serialNumber || typeof cert.serialNumber !== 'string') {
    throw new Error('Invalid certificate: Missing or invalid serialNumber');
  }

  if (!cert.issuer || !Array.isArray(cert.issuer.attributes)) {
    throw new Error('Invalid certificate: Missing or invalid issuer');
  }

  if (!cert.publicKey || typeof cert.publicKey !== 'object') {
    throw new Error('Invalid certificate: Missing publicKey');
  }
};

const checkRevocationStatus = async (cert) => {
  try {
    validateCertificateStructure(cert);

    const issuerCert = await loadAppleIssuer();
    
    // Deep validation of issuer public key
    const issuerKey = issuerCert.publicKey?.subjectPublicKeyInfo?.subjectPublicKey;
    if (!issuerKey || typeof issuerKey !== 'string') {
      console.error('Issuer Public Key Details:', {
        type: typeof issuerKey,
        length: issuerKey?.length,
        fullInfo: issuerCert.publicKey?.subjectPublicKeyInfo
      });
      throw new Error('Issuer public key is missing or invalid format');
    }

    const ocspRequest = forge.ocsp.createRequest({
      certificate: cert,
      issuer: issuerCert
    });

    const response = await new Promise((resolve, reject) => {
      const req = https.request('http://ocsp.apple.com/ocsp04-wwdrca', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ocsp-request',
          'Content-Length': ocspRequest.length
        },
        timeout: 10000
      }, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`OCSP server error: HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.write(ocspRequest.toDer());
      req.end();
    });

    const ocspResp = forge.ocsp.decodeResponse(response);

    return {
      isRevoked: ocspResp.isRevoked || false,
      revocationTime: ocspResp.revokedInfo?.revocationTime || null,
      reason: ocspResp.isRevoked 
        ? `Revoked at ${ocspResp.revokedInfo.revocationTime.toISOString()}`
        : 'Valid certificate',
      ocspStatus: ocspResp.status || 'unknown'
    };

  } catch (error) {
    console.error('OCSP Processing Error:', {
      message: error.message,
      stack: error.stack,
      certificate: cert ? {
        serial: cert.serialNumber,
        issuer: cert.issuer.attributes.map(a => `${a.name || a.shortName}=${a.value}`)
      } : null
    });
    
    return {
      isRevoked: false,
      reason: `Revocation check failed: ${error.message}`,
      ocspStatus: 'error',
      errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }
};

router.get('/check-revocation', async (req, res) => {
  let tempPath;
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

    const p12Asn1 = forge.asn1.fromDer((await fs.readFile(tempPath, 'binary')));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certData.password || '');

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certificate = certBags[forge.pki.oids.certBag]?.[0]?.cert;
    if (!certificate) throw new Error('No valid certificate found in P12');

    const result = await checkRevocationStatus(certificate);

    res.json({
      success: true,
      name: certData.name,
      ...result,
      subject: certificate.subject.attributes.reduce((acc, attr) => {
        if (attr.name || attr.shortName) {
          acc[attr.name || attr.shortName] = attr.value;
        }
        return acc;
      }, {})
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
    if (tempPath) {
      try { await fs.unlink(tempPath); } 
      catch (e) { console.error('Cleanup error:', e.message); }
    }
  }
});

export default router;
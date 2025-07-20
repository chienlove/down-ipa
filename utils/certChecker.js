// utils/certChecker.js
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

function checkP12Certificate(certPath) {
  return new Promise((resolve, reject) => {
    exec(`openssl pkcs12 -info -in "${certPath}" -passin pass:`, (err, stdout, stderr) => {
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

module.exports = { checkP12Certificate };
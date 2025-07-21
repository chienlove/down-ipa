// utils/certChecker.js
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

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
      });
    });
  });
}

export { checkP12Certificate };
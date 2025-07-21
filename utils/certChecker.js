// utils/certChecker.js
import forge from 'node-forge';
import fs from 'fs/promises';

export const checkP12Certificate = async (filePath, password = '') => {
  try {
    // 1. Đọc file P12
    const p12Data = await fs.readFile(filePath, { encoding: 'binary' });
    
    // 2. Chuyển đổi dữ liệu sang định dạng ASN1
    const p12Asn1 = forge.asn1.fromDer(p12Data);
    
    // 3. Giải mã file P12
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    
    // 4. Lấy thông tin certificate
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag] || certBags[forge.pki.oids.certBag].length === 0) {
      throw new Error('No certificate found in P12 file');
    }
    
    const cert = certBags[forge.pki.oids.certBag][0].cert;
    const now = new Date();
    const valid = now >= cert.validity.notBefore && now <= cert.validity.notAfter;

    return {
      valid,
      expiresAt: cert.validity.notAfter.toISOString(),
      subject: cert.subject.attributes.map(attr => ({
        name: attr.name,
        value: attr.value
      })),
      issuer: cert.issuer.attributes.map(attr => ({
        name: attr.name,
        value: attr.value
      }))
    };

  } catch (err) {
    console.error('Certificate check error:', err);
    
    // Xác định loại lỗi cụ thể
    let errorMessage = 'Invalid certificate';
    if (err.message.includes('Invalid password')) {
      errorMessage = 'Wrong password';
    } else if (err.message.includes('Invalid PKCS#12')) {
      errorMessage = 'Invalid P12 file format';
    }
    
    throw new Error(errorMessage);
  }
};
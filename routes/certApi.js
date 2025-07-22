import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';
import https from 'https';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cấu hình Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// 1. Hàm kiểm tra trạng thái thu hồi qua OCSP
const checkRevocationStatus = async (cert) => {
  try {
    // Lấy OCSP URL từ extension của chứng chỉ
    const ocspExtension = cert.getExtension('authorityInfoAccess');
    if (!ocspExtension) {
      return { isRevoked: false, reason: 'Chứng chỉ không hỗ trợ OCSP' };
    }

    const ocspAccess = ocspExtension.accessDescriptions.find(
      ad => ad.accessMethod === '1.3.6.1.5.5.7.48.1' // id-ad-ocsp
    );
    
    if (!ocspAccess) {
      return { isRevoked: false, reason: 'Không tìm thấy OCSP URL' };
    }

    const ocspUrl = ocspAccess.accessLocation.value;
    console.log(`OCSP URL: ${ocspUrl}`);

    // Tạo OCSP Request
    const ocspRequest = forge.ocsp.createRequest({
      certificate: cert,
      issuer: cert // Giả định issuer cert đã có trong chain
    });

    // Gửi request đến máy chủ OCSP của Apple
    const response = await new Promise((resolve, reject) => {
      const req = https.request(ocspUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ocsp-request',
          'Content-Length': ocspRequest.length
        },
        timeout: 10000
      }, (res) => {
        let data = [];
        res.on('data', chunk => data.push(chunk));
        res.on('end', () => resolve(Buffer.concat(data)));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('OCSP request timeout'));
      });

      req.write(ocspRequest.toDer());
      req.end();
    });

    const ocspResponse = forge.ocsp.decodeResponse(response);
    return {
      isRevoked: ocspResponse.isRevoked,
      revocationTime: ocspResponse.revokedInfo?.revocationTime,
      reason: ocspResponse.isRevoked ? 
             `Chứng chỉ đã bị thu hồi lúc ${ocspResponse.revokedInfo.revocationTime.toISOString()}` : 
             'Chứng chỉ chưa bị thu hồi'
    };

  } catch (error) {
    console.error('OCSP Error:', error.message);
    return { 
      isRevoked: false, 
      reason: `Không thể kiểm tra trạng thái thu hồi: ${error.message}`
    };
  }
};

// 2. API Endpoint chính
router.get('/check-revocation', async (req, res) => {
  let tempPath;
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ 
        success: false,
        error: 'Thiếu tham số',
        details: 'Vui lòng cung cấp ID chứng chỉ'
      });
    }

    // A. Lấy thông tin chứng chỉ từ database
    const { data: certData, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (dbError) throw new Error(`Lỗi database: ${dbError.message}`);
    if (!certData) throw new Error(`Không tìm thấy chứng chỉ với ID: ${id}`);
    if (!certData.p12_url) throw new Error('Thiếu URL file P12');

    // B. Tải file P12 từ storage
    const fileKey = certData.p12_url.split('public/')[1] || certData.p12_url;
    const { data: file, error: downloadError } = await supabase.storage
      .from('certificates')
      .download(fileKey);

    if (downloadError) throw new Error(`Tải file thất bại: ${downloadError.message}`);

    // C. Lưu file tạm
    tempPath = path.join(__dirname, `temp_${id}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // D. Đọc chứng chỉ từ file P12
    const p12Data = await fs.readFile(tempPath);
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certData.password || '');

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag]?.length) {
      throw new Error('File P12 không chứa chứng chỉ hợp lệ');
    }

    const certificate = certBags[forge.pki.oids.certBag][0].cert;

    // E. Kiểm tra trạng thái thu hồi
    const { isRevoked, revocationTime, reason } = await checkRevocationStatus(certificate);

    res.json({
      success: true,
      name: certData.name,
      isRevoked,
      revocationTime,
      reason,
      subject: certificate.subject.attributes.reduce((acc, attr) => {
        acc[attr.name || attr.shortName] = attr.value;
        return acc;
      }, {})
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Kiểm tra thất bại',
      details: error.message
    });
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } 
      catch (e) { console.error('Lỗi khi xóa file tạm:', e.message); }
    }
  }
});

export default router;
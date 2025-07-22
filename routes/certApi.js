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

// Cấu hình Supabase với timeout
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { 
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

// Hàm kiểm tra OCSP mạnh mẽ
const checkOCSPStatus = async (cert) => {
  try {
    const ocspExtension = cert.getExtension('authorityInfoAccess');
    if (!ocspExtension) {
      return { isRevoked: false, ocspSupported: false };
    }

    const ocspUrl = ocspExtension.accessDescriptions.find(
      ad => ad.accessMethod === '1.3.6.1.5.5.7.48.1'
    )?.accessLocation.value;

    if (!ocspUrl) {
      return { isRevoked: false, ocspSupported: false };
    }

    const ocspRequest = forge.ocsp.createRequest({ certificate: cert });
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
      ocspSupported: true
    };

  } catch (error) {
    console.error('OCSP Error:', error.message);
    return { isRevoked: false, ocspSupported: false };
  }
};

// Hàm kiểm tra chứng chỉ toàn diện
const verifyCertificate = async (filePath, password) => {
  try {
    // 1. Đọc file P12
    const p12Data = await fs.readFile(filePath);
    
    // 2. Giải mã P12
    const p12Asn1 = forge.asn1.fromDer(p12Data.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password, false, ['certBag']);

    // 3. Lấy chứng chỉ
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag]?.length) {
      throw new Error('Không tìm thấy chứng chỉ trong file P12');
    }
    const cert = certBags[forge.pki.oids.certBag][0].cert;

    // 4. Kiểm tra thời hạn
    const now = new Date();
    const isExpired = now < cert.validity.notBefore || now > cert.validity.notAfter;

    // 5. Kiểm tra OCSP (chỉ khi chứng chỉ chưa hết hạn)
    let ocspCheck = { isRevoked: false, ocspSupported: false };
    if (!isExpired) {
      ocspCheck = await checkOCSPStatus(cert);
    }

    return {
      cert,
      isValid: !isExpired && !ocspCheck.isRevoked,
      isExpired,
      ...ocspCheck
    };

  } catch (error) {
    console.error('Verify Certificate Error:', error);
    throw error;
  }
};

// API Endpoint với error handling toàn diện
router.get('/check', async (req, res) => {
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

    // 1. Lấy thông tin từ database
    const { data: certRecord, error: dbError } = await supabase
      .from('certificates')
      .select('id, name, p12_url, password')
      .eq('id', id)
      .single();

    if (dbError) throw new Error(`Database error: ${dbError.message}`);
    if (!certRecord) throw new Error(`Không tìm thấy chứng chỉ với ID: ${id}`);
    if (!certRecord.p12_url) throw new Error('Thiếu URL file P12');

    // 2. Tải file từ storage
    const fileKey = certRecord.p12_url.split('public/')[1] || certRecord.p12_url;
    const { data: file, error: downloadError } = await supabase.storage
      .from('certificates')
      .download(encodeURIComponent(fileKey));

    if (downloadError) {
      throw new Error(`Tải file thất bại: ${downloadError.message} (Key: ${fileKey})`);
    }

    // 3. Lưu file tạm
    tempPath = path.join(__dirname, `temp_${Date.now()}.p12`);
    await fs.writeFile(tempPath, Buffer.from(await file.arrayBuffer()));

    // 4. Kiểm tra chứng chỉ
    const { cert, isValid, isExpired, isRevoked, revocationTime } = await verifyCertificate(
      tempPath, 
      certRecord.password || ''
    );

    res.json({
      success: true,
      name: certRecord.name,
      valid: isValid,
      isExpired,
      isRevoked,
      revocationTime: revocationTime?.toISOString(),
      expiresAt: cert.validity.notAfter.toISOString(),
      subject: cert.subject.attributes.map(attr => ({
        name: attr.name,
        value: attr.value
      })),
      issuer: cert.issuer.attributes.map(attr => ({
        name: attr.name,
        value: attr.value
      }))
    });

  } catch (error) {
    console.error('API Error:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // Phân loại lỗi chi tiết
    let errorDetails = error.message;
    if (error.message.includes('Invalid password')) {
      errorDetails = 'Mật khẩu chứng chỉ không đúng';
    } else if (error.message.includes('No certificate found')) {
      errorDetails = 'File P12 không hợp lệ hoặc không chứa chứng chỉ';
    } else if (error.message.includes('Tải file thất bại')) {
      errorDetails = error.message;
    }

    res.status(500).json({
      success: false,
      error: 'Kiểm tra chứng chỉ thất bại',
      details: errorDetails || 'Lỗi không xác định'
    });
  } finally {
    // Dọn dẹp file tạm
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
        console.log('Đã xóa file tạm:', tempPath);
      } catch (cleanupError) {
        console.error('Lỗi khi xóa file tạm:', cleanupError.message);
      }
    }
  }
});

export default router;
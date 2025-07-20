// app.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const port = process.env.PORT || 3000;

// Khởi tạo Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Import hàm kiểm tra
const { checkP12Certificate } = require('./utils/certChecker');

// Route kiểm tra chứng chỉ
app.get('/check-cert', async (req, res) => {
  const { cert } = req.query;

  if (!cert) {
    return res.status(400).json({ error: 'Missing cert parameter' });
  }

  try {
    const certPath = path.join(__dirname, 'temp.p12');

    // Tải file từ Supabase
    const { data, error } = await supabase
      .storage
      .from('certificates')
      .download(cert);

    if (error) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const buffer = await data.arrayBuffer();
    fs.writeFileSync(certPath, Buffer.from(buffer));

    // Kiểm tra .p12
    const certInfo = await checkP12Certificate(certPath);

    // Xóa file tạm
    fs.unlinkSync(certPath);

    return res.json(certInfo);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Certificate checker API running on http://localhost:${port}`);
});
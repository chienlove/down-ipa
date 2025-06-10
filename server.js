const express = require('express');
const path = require('path');
const app = express();
const { exec } = require('child_process');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/.well-known/acme-challenge', express.static(path.join(__dirname, '.well-known', 'acme-challenge')));

// Existing routes...

app.post('/purchase-only', async (req, res) => {
  const { APPLE_ID, PASSWORD, CODE, APPID } = req.body;

  if (!APPLE_ID || !PASSWORD || !APPID) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin đăng nhập hoặc App ID.' });
  }

  const purchaseCmd = [
    'ipatool',
    'purchase',
    '--bundle-id', APPID,
    '--account', APPLE_ID,
    '--password', PASSWORD
  ];

  if (CODE) {
    purchaseCmd.push('--otp', CODE);
  }

  console.log('Running purchase command:', purchaseCmd.join(' '));

  try {
    const { stdout, stderr } = await exec(purchaseCmd.join(' '), { timeout: 60000 });
    console.log('Purchase success:', stdout);
    res.json({ success: true, message: 'Đã thêm vào mục Đã mua thành công.' });
  } catch (err) {
    console.error('Purchase failed:', err.stderr || err.message);
    res.status(500).json({ success: false, error: 'Không thể thêm vào mục Đã mua.', detail: err.stderr || err.message });
  }
});

app.listen(3000, () => console.log('Server started'));

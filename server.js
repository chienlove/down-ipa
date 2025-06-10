import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/.well-known/acme-challenge', express.static(path.join(__dirname, '.well-known', 'acme-challenge')));

// Route: purchase-only
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
    const { stdout } = await exec(purchaseCmd.join(' '), { timeout: 60000 });
    console.log('Purchase success:', stdout);
    res.json({ success: true, message: 'Đã thêm vào mục Đã mua thành công.' });
  } catch (err) {
    console.error('Purchase failed:', err.stderr || err.message);
    res.status(500).json({ success: false, error: 'Không thể thêm vào mục Đã mua.', detail: err.stderr || err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

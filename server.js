import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Store } from './src/client.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Route: /purchase-only
app.post('/purchase-only', async (req, res) => {
  const { APPLE_ID, PASSWORD, CODE, APPID } = req.body;

  if (!APPLE_ID || !PASSWORD || !APPID) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin đăng nhập hoặc App ID.' });
  }

  try {
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

    if (!user || user._state !== 'success') {
      return res.status(401).json({
        success: false,
        error: user?.customerMessage || 'Đăng nhập thất bại'
      });
    }

    const result = await Store.purchase(APPID, user);

    if (result?._state === 'success') {
      return res.json({ success: true, message: 'Đã thêm vào mục Đã mua thành công.' });
    } else {
      return res.status(500).json({
        success: false,
        error: result?.customerMessage || 'Không thể thêm vào mục Đã mua.'
      });
    }
  } catch (error) {
    console.error('Purchase error:', error);
    return res.status(500).json({
      success: false,
      error: 'Đã xảy ra lỗi khi thêm vào mục Đã mua.',
      detail: error.message || String(error)
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

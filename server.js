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

app.post('/purchased-apps', async (req, res) => {
  const { APPLE_ID, PASSWORD, CODE } = req.body;

  if (!APPLE_ID || !PASSWORD) {
    return res.status(400).json({ success: false, error: 'Thiếu tài khoản hoặc mật khẩu.' });
  }

  try {
    const user = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

    if (!user || user._state !== 'success') {
      return res.status(401).json({ success: false, error: user?.customerMessage || 'Đăng nhập thất bại.' });
    }

    const apps = await Store.purchaseHistory(user);

    res.json({ success: true, apps });
  } catch (err) {
    console.error('Lỗi lấy danh sách đã mua:', err);
    res.status(500).json({ success: false, error: 'Không thể lấy danh sách đã mua.', detail: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

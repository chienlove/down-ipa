
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { Store } from './client.js';

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json());

app.get('/health', (_, res) => res.send('OK'));

app.post('/auth', async (req, res) => {
  try {
    const { APPLE_ID, PASSWORD, CODE } = req.body;
    const result = await Store.authenticate(APPLE_ID, PASSWORD, CODE);

    if (result.success) {
      return res.json({
        success: true,
        message: result.message,
        sessionId: result.sessionId,
        scnt: result.scnt
      });
    }

    if (result.require2FA) {
      return res.json({
        require2FA: true,
        message: result.message,
        sessionId: result.sessionId,
        scnt: result.scnt
      });
    }

    return res.status(401).json({
      success: false,
      message: result.message || '❌ Đăng nhập thất bại',
      debug: result
    });
  } catch (err) {
    console.error('💥 Lỗi backend /auth:', err);
    res.status(500).json({ success: false, error: '🚨 Lỗi máy chủ: ' + err.message });
  }
});

app.post('/download', async (req, res) => {
  try {
    const { appIdentifier, appVerId, dsid, passwordToken } = req.body;
    const result = await Store.download(appIdentifier, appVerId, dsid, passwordToken);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// pages/api/download.js

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

const execFileAsync = promisify(execFile);
const sessions = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { appleId, password, appId, appVerId, twoFactorCode, sessionId } = req.body;

    process.env.HOME = '/tmp';
    process.env.TMPDIR = '/tmp';

    const ipatoolPath = path.join('/tmp', 'ipatool');
    await fs.copyFile(
      path.join(process.cwd(), 'public', 'bin', 'ipatool'),
      ipatoolPath
    );
    await fs.chmod(ipatoolPath, 0o755);

    // Logic xử lý session + login + tải IPA
    // (Giữ nguyên đoạn bạn đã viết)

    // Cuối cùng: trả về file IPA cho người dùng
  } catch (error) {
    console.error('Error during download:', error);
    return res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      message: error.message || 'Tải xuống thất bại'
    });
  }
}
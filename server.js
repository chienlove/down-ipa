import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Store } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// API Endpoints
app.post('/auth', async (req, res) => {
    try {
        const { APPLE_ID, PASSWORD } = req.body;
        const result = await Store.authenticate(APPLE_ID, PASSWORD);
        
        if (result._state === 'needs2fa') {
            return res.json({
                success: false,
                require2FA: true,
                message: result.customerMessage,
                dsid: result.dsPersonId
            });
        }

        if (result._state === 'success') {
            return res.json({ 
                success: true,
                dsid: result.dsPersonId
            });
        }

        res.status(401).json({
            success: false,
            error: result.customerMessage,
            require2FA: false
        });

    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({
            success: false,
            error: 'Lỗi hệ thống'
        });
    }
});

app.post('/verify', async (req, res) => {
    try {
        const { APPLE_ID, PASSWORD, CODE, dsid } = req.body;
        
        if (!CODE || CODE.length !== 6) {
            return res.status(400).json({ 
                success: false, 
                error: 'Mã xác minh phải có 6 chữ số' 
            });
        }

        const result = await Store.authenticate(APPLE_ID, PASSWORD, CODE);
        
        if (result._state === 'success') {
            return res.json({ 
                success: true,
                dsid: result.dsPersonId || dsid
            });
        }

        res.status(401).json({
            success: false,
            error: result.customerMessage || 'Mã xác minh không đúng',
            require2FA: true
        });

    } catch (error) {
        console.error('Verify error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Lỗi xác minh 2FA' 
        });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
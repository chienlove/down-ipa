import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
    static get guid() {
        return getMAC().replace(/:/g, '').toUpperCase();
    }

    static async authenticate(email, password, mfa = null) {
    const authUrl = `https://auth.itunes.apple.com/auth/v1/native/fast?guid=${this.guid}`;
    const dataJson = {
        appleId: email,
        attempt: mfa ? 2 : 4,
        createSession: 'true',
        guid: this.guid,
        password: mfa ? `${password}${mfa}` : password,
        rmp: 0,
        why: 'signIn'
    };

    try {
        this.cookieJar.removeAllCookies();
        const resp = await this.fetch(authUrl, {
            method: 'POST',
            body: plist.build(dataJson),
            headers: this.Headers,
            redirect: 'manual'
        });

        const responseText = await resp.text();
        console.log('Raw Apple Response:', responseText); // Log toàn bộ nội dung XML

        // Phân tích response theo cấu trúc thực tế
        if (resp.status === 200) {
            // Kiểm tra nội dung response thay vì chỉ status code
            if (responseText.includes('<key>dsPersonId</key>')) {
                const parsed = plist.parse(responseText);
                if (parsed.dsPersonId) {
                    return {
                        _state: 'success',
                        dsPersonId: parsed.dsPersonId
                    };
                }
            }

            // Phát hiện 2FA qua nội dung response
            if (responseText.includes('verification code') || 
                responseText.includes('MZFinance.BadLogin.Configurator_message')) {
                const dsid = resp.headers.get('x-dsid') || 'unknown';
                return {
                    _state: 'needs2fa',
                    dsPersonId: dsid,
                    customerMessage: 'Vui lòng nhập mã xác minh 2FA'
                };
            }

            // Phát hiện sai mật khẩu
            if (responseText.includes('invalid credentials') || 
                responseText.includes('bad login')) {
                return {
                    _state: 'failure',
                    failureType: 'bad_login',
                    customerMessage: 'Sai tài khoản hoặc mật khẩu'
                };
            }
        }

        // Mặc định trả về lỗi không xác định nếu không match các trường hợp trên
        return {
            _state: 'failure',
            failureType: 'unknown',
            customerMessage: 'Lỗi không xác định từ Apple'
        };

    } catch (error) {
        console.error('Auth Error:', error);
        return {
            _state: 'failure',
            failureType: 'network',
            customerMessage: 'Lỗi kết nối đến Apple'
        };
    }
}

    // ... (các phương thức khác giữ nguyên)
}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);
Store.Headers = {
    'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
    'Content-Type': 'application/x-www-form-urlencoded',
};

export { Store };
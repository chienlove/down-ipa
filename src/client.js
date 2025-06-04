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
            const cookies = await this.cookieJar.getCookies(authUrl); // Sửa thành authUrl thay vì url
            const dsid = resp.headers.get('x-dsid') || cookies.find(c => c.key === 'X-Dsid')?.value || null;

            console.log('Auth Debug:', {
                status: resp.status,
                headers: Object.fromEntries(resp.headers.entries()),
                body: responseText
            });

            // Xử lý response
            if (resp.status === 200 && dsid) {
                return { _state: 'success', dsPersonId: dsid };
            }

            if (resp.status === 409 || resp.headers.get('x-apple-twosv-challenge')) {
                return {
                    _state: 'needs2fa',
                    dsPersonId: dsid,
                    customerMessage: 'Vui lòng nhập mã xác minh 2FA'
                };
            }

            if (resp.status === 401) {
                return {
                    _state: 'failure',
                    failureType: 'bad_login',
                    customerMessage: 'Sai tài khoản hoặc mật khẩu'
                };
            }

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
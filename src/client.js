import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
    static get guid() {
        return getMAC().replace(/:/g, '').toUpperCase();
    }

    static async authenticate(email, password, mfa) {
        const dataJson = {
            appleId: email,
            attempt: mfa ? 2 : 4,
            createSession: 'true',
            guid: this.guid,
            password: `${password}${mfa ?? ''}`,
            rmp: 0,
            why: 'signIn'
        };
        
        const body = plist.build(dataJson);
        const url = `https://auth.itunes.apple.com/auth/v1/native/fast?guid=${this.guid}`;
        
        try {
            this.cookieJar.removeAllCookies();
            const resp = await this.fetch(url, {
                method: 'POST',
                body,
                headers: this.Headers,
                redirect: 'manual'
            });

            // Phát hiện 2FA qua status code và headers
            const is2FA = resp.status === 409 || 
                         resp.headers.get('x-apple-twosv-code') ||
                         /(verification|code|2fa)/i.test(resp.headers.get('x-apple-as-results') || '');

            if (is2FA) {
                return {
                    _state: 'needs2fa',
                    dsPersonId: resp.headers.get('x-dsid'),
                    customerMessage: 'Vui lòng nhập mã xác minh 2FA'
                };
            }

            if (resp.status === 200 && resp.headers.get('x-dsid')) {
                return {
                    _state: 'success',
                    dsPersonId: resp.headers.get('x-dsid')
                };
            }

            return {
                _state: 'failure',
                failureType: 'bad_login',
                customerMessage: 'Sai tài khoản hoặc mật khẩu'
            };

        } catch (error) {
            console.error('Authentication error:', error);
            return {
                _state: 'failure',
                failureType: 'network',
                customerMessage: 'Lỗi kết nối đến Apple'
            };
        }
    }
}

// Khởi tạo cookie jar
Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);
Store.Headers = {
    'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
    'Content-Type': 'application/x-www-form-urlencoded'
};

export { Store };
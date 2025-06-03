import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
    static async authenticate(email, password) {
        const url = 'https://idmsa.apple.com/appleauth/auth/signin';

        const headers = {
            'Content-Type': 'application/json',
            'X-Apple-Widget-Key': 'f96d30e4d80c24c6f1c3c123c7aa3e5f',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': 'https://idmsa.apple.com',
            'Referer': 'https://idmsa.apple.com/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko)'
        };

        const body = {
            accountName: email,
            password: password,
            rememberMe: false
        };

        try {
            const resp = await this.fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                redirect: 'manual'
            });

            const status = resp.status;
            const text = await resp.text();
            let json = {};

            try {
                json = JSON.parse(text);
            } catch (e) {}

            if (status === 200) {
                return { _state: 'success' };
            }

            if (status === 409) {
                return {
                    _state: 'failure',
                    failureType: 'mfa',
                    customerMessage: 'Yêu cầu xác minh hai yếu tố',
                    scnt: resp.headers.get('scnt'),
                    sessionId: resp.headers.get('x-apple-id-session-id'),
                    trustedDevices: json.trustedDevices || []
                };
            }

            if (status === 401) {
                return {
                    _state: 'failure',
                    failureType: 'invalid_credentials',
                    customerMessage: json.service_errors?.[0]?.message || 'Đăng nhập thất bại'
                };
            }

            return {
                _state: 'failure',
                failureType: 'unknown_error',
                customerMessage: json.service_errors?.[0]?.message || 'Lỗi không xác định từ Apple',
                status
            };
        } catch (err) {
            return {
                _state: 'failure',
                failureType: 'network_error',
                customerMessage: err.message
            };
        }
    }

    static async download(appIdentifier, appVerId, Cookie) {
        throw new Error("Download chưa được hỗ trợ trong phiên bản IDMSA-only.");
    }
}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);

export { Store };

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
        const parsedResponse = plist.parse(responseText); // Phân tích response XML
        
        console.log('Full Apple Response:', {
            status: resp.status,
            headers: Object.fromEntries(resp.headers.entries()),
            body: parsedResponse
        });

        // Xử lý response theo nội dung thực tế
        if (resp.status === 200) {
            if (parsedResponse?.customerMessage?.includes('verification code')) {
                return {
                    _state: 'needs2fa',
                    dsPersonId: parsedResponse.dsPersonId,
                    customerMessage: 'Vui lòng nhập mã xác minh 2FA'
                };
            }
            
            if (parsedResponse?.dsPersonId) {
                return {
                    _state: 'success',
                    dsPersonId: parsedResponse.dsPersonId
                };
            }
        }

        // Xử lý các trường hợp lỗi
        if (parsedResponse?.failureType) {
            return {
                _state: 'failure',
                failureType: parsedResponse.failureType,
                customerMessage: parsedResponse.customerMessage || 'Lỗi xác thực'
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
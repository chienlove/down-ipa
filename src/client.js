import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
    static get guid() {
        return getMAC().replace(/:/g, '').toUpperCase();
    }

    static async authenticate(email, password, mfa = null) {
        const dataJson = {
            appleId: email,
            attempt: mfa ? 2 : 4,
            createSession: 'true',
            guid: this.guid,
            password: `${password}${mfa ?? ''}`,
            rmp: 0,
            why: 'signIn',
        };

        const body = plist.build(dataJson);
        const url = `https://auth.itunes.apple.com/auth/v1/native/fast?guid=${this.guid}`;

        try {
            const resp = await this.fetch(url, {
                method: 'POST',
                body,
                headers: this.Headers
            });

            // Kiểm tra HTTP status code
            if (!resp.ok) {
                throw new Error(`Apple API returned ${resp.status}: ${resp.statusText}`);
            }

            const responseText = await resp.text();
            const parsedResp = plist.parse(responseText);
            console.log('Raw Apple Auth Response:', JSON.stringify(parsedResp, null, 2));

            // Xác định trạng thái đăng nhập
            const isSuccess = this._checkAuthSuccess(parsedResp);
            
            return {
                ...parsedResp,
                _state: isSuccess ? 'success' : 'failure',
                _isAuthenticated: isSuccess,
                _debug: {
                    hasFailureType: !!parsedResp.failureType,
                    hasCustomerMessage: !!parsedResp.customerMessage,
                    hasDsPersonId: !!parsedResp.dsPersonId
                }
            };

        } catch (error) {
            console.error('Authentication Error:', error);
            return {
                _state: 'failure',
                customerMessage: 'Lỗi kết nối đến Apple',
                error: error.message,
                _isAuthenticated: false
            };
        }
    }

    static _checkAuthSuccess(response) {
        // Kiểm tra tất cả điều kiện có thể cho thấy thất bại
        if (response.failureType || 
            response.customerMessage?.toLowerCase().includes('invalid') ||
            !response.dsPersonId) {
            return false;
        }
        
        // Thêm các kiểm tra đặc thù của Apple
        if (response.status === 'failed' || 
            response.passwordToken === 'FAILED') {
            return false;
        }

        return true;
    }

    static async download(appIdentifier, appVerId, Cookie) {
        const dataJson = {
            creditDisplay: '',
            guid: this.guid,
            salableAdamId: appIdentifier,
            ...(appVerId && {externalVersionId: appVerId})
        };

        const body = plist.build(dataJson);
        const url = `https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/volumeStoreDownloadProduct?guid=${this.guid}`;

        try {
            const resp = await this.fetch(url, {
                method: 'POST', 
                body,
                headers: {
                    ...this.Headers,
                    'X-Dsid': Cookie.dsPersonId,
                    'iCloud-DSID': Cookie.dsPersonId
                }
            });

            const parsedResp = plist.parse(await resp.text());
            return {
                ...parsedResp,
                _state: parsedResp.failureType ? 'failure' : 'success'
            };

        } catch (error) {
            console.error('Download Error:', error);
            return {
                _state: 'failure',
                error: error.message
            };
        }
    }
}

// Khởi tạo fetch với cookie support
Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);

// Headers mặc định
Store.Headers = {
    'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
    'Content-Type': 'application/x-www-form-urlencoded',
};

export { Store };
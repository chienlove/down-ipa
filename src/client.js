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
        password: mfa ? `${password}${mfa}` : password,
        rmp: 0,
        why: 'signIn'
    };

    try {
        this.cookieJar.removeAllCookies();
        const resp = await this.fetch(`https://auth.itunes.apple.com/auth/v1/native/fast?guid=${this.guid}`, {
            method: 'POST',
            body: plist.build(dataJson),
            headers: this.Headers,
            redirect: 'manual'
        });

        const responseText = await resp.text();
        const cookies = await this.cookieJar.getCookies(url);
        const dsid = resp.headers.get('x-dsid') || cookies.find(c => c.key === 'X-Dsid')?.value || null;

        // Debug log quan trọng
        console.log(`Auth Debug - Status: ${resp.status}, Headers: ${JSON.stringify([...resp.headers])}, Body: ${responseText}`);

        // Xử lý response theo status code
        switch(resp.status) {
            case 200:
                if (dsid) {
                    return { _state: 'success', dsPersonId: dsid };
                }
                break;
                
            case 409: // 2FA required
            case 401: // Có thể là 2FA
                if (/MZFinance\.BadLogin\.Configurator_message|two-step verification required/i.test(responseText) ||
                    resp.headers.get('x-apple-twosv-challenge')) {
                    return { 
                        _state: 'needs2fa', 
                        dsPersonId: dsid,
                        customerMessage: 'Vui lòng nhập mã xác minh 2FA' 
                    };
                }
                return {
                    _state: 'failure',
                    failureType: 'bad_login',
                    customerMessage: 'Sai tài khoản hoặc mật khẩu'
                };
                
            default:
                console.error('Unknown response:', { status: resp.status, body: responseText });
        }

        return {
            _state: 'failure',
            failureType: 'unknown',
            customerMessage: 'Lỗi không xác định từ Apple'
        };

    } catch (error) {
        console.error('Auth error:', error);
        return {
            _state: 'failure',
            failureType: 'network',
            customerMessage: 'Lỗi kết nối đến Apple'
        };
    }
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
        return {...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success'};
    }
}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);
Store.Headers = {
    'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
    'Content-Type': 'application/x-www-form-urlencoded',
};

export { Store };
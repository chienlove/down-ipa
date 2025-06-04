import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
    static get guid() {
        return getMAC().replace(/:/g, '').toUpperCase();
    }

    static async authenticate(email, password, mfa = null) {
    const attempt = mfa ? 2 : 4; // 2 = có 2FA, 4 = không có
    const authPassword = mfa ? password : `${password}${mfa ?? ''}`;

    const dataJson = {
        appleId: email,
        attempt,
        createSession: 'true',
        guid: this.guid,
        password: authPassword,
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
        const dsid = resp.headers.get('x-dsid') || 'unknown';

        // Phát hiện 2FA CHÍNH XÁC theo Apple
        const is2FA = resp.status === 409 
            || resp.headers.get('x-apple-twosv-challenge')
            || /two-step verification required/i.test(responseText);

        // Phát hiện sai mật khẩu CHÍNH XÁC
        const isInvalidCreds = resp.status === 401 
            || /invalid credentials|bad login/i.test(responseText);

        if (resp.status === 200 && dsid !== 'unknown') {
            return { _state: 'success', dsPersonId: dsid };
        }

        if (is2FA) {
            return { 
                _state: 'needs2fa', 
                dsPersonId: dsid,
                customerMessage: 'Vui lòng nhập mã xác minh 2FA từ thiết bị tin cậy' 
            };
        }

        if (isInvalidCreds) {
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
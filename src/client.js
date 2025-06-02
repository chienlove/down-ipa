import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
    static get guid() {
        return getMAC().replace(/:/g, '').toUpperCase();
    }

// client.js
static async authenticate(email, password, mfa) {
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
        // Reset cookie jar trước mỗi lần thử
        this.cookieJar.removeAllCookies();
        
        const resp = await this.fetch(url, {method: 'POST', body, headers: this.Headers});
        const textResponse = await resp.text();
        const cookies = await this.cookieJar.getCookies(url);
        
        // Phát hiện 2FA qua cookies
        const hasAuthToken = cookies.some(c => c.key === 'myacinfo');
        const has2FACookie = cookies.some(c => c.key.includes('X-Apple-ID-Session'));
        
        if (has2FACookie && hasAuthToken) {
            const dsid = cookies.find(c => c.key === 'X-Dsid')?.value;
            return {
                _state: 'needs2fa',
                dsPersonId: dsid,
                customerMessage: 'Vui lòng nhập mã xác minh từ thiết bị tin cậy'
            };
        }
        
        // Nếu có myacinfo nhưng không có 2FA -> thành công
        if (hasAuthToken && !has2FACookie) {
            const dsid = cookies.find(c => c.key === 'X-Dsid')?.value;
            return {
                _state: 'success',
                dsPersonId: dsid
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
            method: 'POST', body,
            headers: {...this.Headers, 'X-Dsid': Cookie.dsPersonId, 'iCloud-DSID': Cookie.dsPersonId}
            //'X-Token': Cookie.passwordToken
        });
        const parsedResp = plist.parse(await resp.text());
        //console.log(JSON.stringify(parsedResp));
        return {...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success'};
    }

}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);
Store.Headers = {
    'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
    'Content-Type': 'application/x-www-form-urlencoded',
};
export {Store};
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
        password: mfa ? password : `${password}${mfa ?? ''}`,
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

        const responseText = await resp.text();
        const cookies = await this.cookieJar.getCookies(url);
        const dsid = resp.headers.get('x-dsid') || cookies.find(c => c.key === 'X-Dsid')?.value || 'unknown';

        // Logic giống hệt StoreClient.swift
        if (resp.status === 200 && dsid !== 'unknown') {
            return {
                _state: 'success',
                dsPersonId: dsid
            };
        }

        // Kiểm tra 2FA theo cách của StoreClient
        const storeFront = resp.headers.get('x-set-apple-store-front');
        const is2FA = resp.status === 409 || 
                     (storeFront && storeFront.includes('-2')) || // Giống StoreClient.swift
                     /MZFinance\.BadLogin\.Configurator_message/i.test(responseText);

        if (is2FA) {
            return {
                _state: 'needs2fa',
                dsPersonId: dsid,
                customerMessage: 'Vui lòng nhập mã xác minh 2FA'
            };
        }

        // Sai mật khẩu thì trả về ngay, không chuyển step 2
        return {
            _state: 'failure',
            failureType: 'invalid_credentials', // Giống StoreClient
            customerMessage: 'Sai tài khoản hoặc mật khẩu'
        };

    } catch (error) {
        return {
            _state: 'failure',
            failureType: 'network',
            customerMessage: 'Lỗi kết nối'
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
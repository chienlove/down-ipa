import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
    static async check2FAStatus(email) {
        const url = 'https://idmsa.apple.com/appleauth/auth/signin';
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Apple-Widget-Key': 'd9d6d97a1e7c4f2ebc4ef5f2f5e1a3c6',
            'User-Agent': 'Asspp/1.2.10 (iPhone; iOS 17.0)',
        };
        const body = JSON.stringify({
            accountName: email,
            password: 'invalidpassword123!',
            rememberMe: true
        });

        try {
            const res = await nodeFetch(url, { method: 'POST', headers, body });
            const json = await res.json();
            if (res.status === 409 && json.authType === 'hsa2') {
                return '2fa';
            }
        } catch (_) {}
        return 'normal';
    }
    
    static get guid() {
        return getMAC().replace(/:/g, '').toUpperCase();
    }

    static async authenticate(email, password, mfa) {
        const authType = await this.check2FAStatus(email);
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
        const resp = await this.fetch(url, {
            method: 'POST',
            body,
            headers: this.Headers
        });
        const parsedResp = plist.parse(await resp.text());
        //console.log(JSON.stringify(parsedResp));
        return { ...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success' };
    }

    static async download(appIdentifier, appVerId, Cookie) {
        const dataJson = {
            creditDisplay: '',
            guid: this.guid,
            salableAdamId: appIdentifier,
            ...(appVerId && { externalVersionId: appVerId })
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
                // 'X-Token': Cookie.passwordToken
            }
        });
        const parsedResp = plist.parse(await resp.text());
        //console.log(JSON.stringify(parsedResp));
        return { ...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success' };
    }
}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);
Store.Headers = {
    'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
    'Content-Type': 'application/x-www-form-urlencoded',
};

export { Store };
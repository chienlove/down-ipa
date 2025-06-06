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

        const rawMessage = parsedResp.customerMessage?.toLowerCase() || '';
        const is2FA =
            parsedResp.failureType === 'MZFinance.BadLogin.Configurator_message' &&
            (rawMessage.includes('mã xác minh') ||
             rawMessage.includes('two-factor') ||
             rawMessage.includes('mfa') ||
             rawMessage.includes('code'));

        const state = parsedResp.failureType ? 'failure' : 'success';

        return {
            ...parsedResp,
            _state: state,
            authType: is2FA ? '2fa' : 'normal'
        };

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
        
const message = parsedResp.customerMessage?.toLowerCase() || '';
const failureType = parsedResp.failureType || '';

const isBadCredentials = (
    failureType.includes('MZFinance.BadLogin') ||
    message.includes('id') || 
    message.includes('mật khẩu') ||
    message.includes('incorrect') ||
    message.includes('invalid')
);

const is2FA = (
    failureType === 'MZFinance.BadLogin.Configurator_message' &&
    (message.includes('mã xác minh') ||
     message.includes('two-factor') ||
     message.includes('mfa') ||
     message.includes('code'))
);

const state = isBadCredentials ? 'failure' : (parsedResp.failureType ? 'failure' : 'success');

return {
    ...parsedResp,
    _state: state,
    authType: is2FA ? '2fa' : 'normal'
};

    }
}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFet
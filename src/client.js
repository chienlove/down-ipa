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
        const resp = await this.fetch(url, { method: 'POST', body, headers: this.Headers });
        const parsedResp = plist.parse(await resp.text());

        // 🛡 Phát hiện đăng nhập sai dù _state = "success"
        const isBadLogin = parsedResp.customerMessage?.includes('BadLogin') ||
                           parsedResp.customerMessage?.includes('MZFinance.BadLogin');

        const result = {
            ...parsedResp,
            _state: (parsedResp.failureType || isBadLogin) ? 'failure' : 'success'
        };

        // 👀 Nếu _state = "success" nhưng chưa có MFA, kiểm tra gián tiếp
        if (result._state === 'success' && !mfa) {
            const trustedCheck = await this.check2FARequirement(result);
            if (trustedCheck === 'NEEDS_2FA') {
                result._state = 'failure';
                result.failureType = 'mfa';
                result.customerMessage = 'Yêu cầu xác minh 2FA (được xác định gián tiếp)';
            }
        }

        return result;
    }

    static async check2FARequirement(parsedResp) {
        try {
            const sessionId = parsedResp.sessionId;
            const scnt = parsedResp.scnt;
            const cookieHeader = parsedResp.setCookie || '';

            const resp = await this.fetch('https://idmsa.apple.com/appleauth/auth/verify/trusteddevice', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Apple-ID-Session-Id': sessionId,
                    'scnt': scnt,
                    'Cookie': cookieHeader
                },
                body: '{}'
            });

            if (resp.status === 200) {
                const body = await resp.text();
                if (body.includes('securityCode')) return 'NEEDS_2FA';
            } else if (resp.status === 401) {
                return 'LOGIN_FAILED';
            } else if (resp.status === 403) {
                return 'LOGIN_SUCCESS_NO_2FA';
            }
        } catch (err) {
            console.error('check2FARequirement error:', err.message);
        }

        return 'UNKNOWN';
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
            method: 'POST', body,
            headers: {
                ...this.Headers,
                'X-Dsid': Cookie.dsPersonId,
                'iCloud-DSID': Cookie.dsPersonId
            }
        });
        const parsedResp = plist.parse(await resp.text());
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
import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

class Store {
    static get guid() {
        return getMAC().replace(/:/g, '').toUpperCase();
    }

    static async authenticate(email, password, code) {
        const form = new URLSearchParams({
            appleId: email,
            password: password,
        });

        if (code) {
            form.set('oneTimePassword', code);
        }

        const url = 'https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate';

        const resp = await this.fetch(url, {
            method: 'POST',
            body: form.toString(),
            headers: {
                ...this.Headers,
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        });

        const xml = await resp.text();
        const parsed = await parseStringPromise(xml, { explicitArray: false });
        const plistContent = parsed['plist']['dict'];

        // Extract dsid
        let dsid = null;
        let failureType = null;

        const keys = Array.isArray(plistContent.key) ? plistContent.key : [plistContent.key];
        const values = Array.isArray(plistContent.string) ? plistContent.string : [plistContent.string];

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const value = values[i];
            if (key === 'dsPersonId') {
                dsid = value;
            }
            if (key === 'failureType') {
                failureType = value;
            }
        }

        if (dsid) {
            return { _state: 'success', dsPersonId: dsid, raw: plistContent };
        } else if (!dsid && code == null) {
            return { _state: '2fa_required', raw: plistContent };
        } else {
            return { _state: 'failure', failureType: failureType, raw: plistContent };
        }
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
            }
        });
        const parsedResp = plist.parse(await resp.text());
        return { ...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success' };
    }
}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);
Store.Headers = {
    'User-Agent': 'iTunes/12.10.1 (Macintosh; OS X 10.14.6) AppleWebKit/7607.1.40.1.5',
};

export { Store };
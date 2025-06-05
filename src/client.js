import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
  static get guid() {
    return getMAC().replace(/:/g, '').toUpperCase();
  }

  static async authenticate(email, password, code) {
    const payload = {
      appleId: email,
      attempt: code ? 2 : 4,
      createSession: 'true',
      guid: this.guid,
      password: code ? `${password}${code}` : password,
      rmp: 0,
      why: 'signIn'
    };

    const body = plist.build(payload);
    const url = `https://auth.itunes.apple.com/auth/v1/native/fast?guid=${this.guid}`;

    const response = await this.fetch(url, {
      method: 'POST',
      body,
      headers: this.Headers
    });

    const rawText = await response.text();
    const parsed = plist.parse(rawText);

    const msg = (parsed.customerMessage || '').toLowerCase();
    const failure = (parsed.failureType || '').toLowerCase();
    const dsid = parsed.dsPersonId || 'unknown';

    const is2FA =
  msg.includes('code') ||
  msg.includes('device') ||
  msg.includes('trusted') ||
  msg.includes('verification') ||
  msg.includes('two-factor');

const isBadLogin =
  failure === 'invalidcredentials';

    console.log('[DEBUG Apple Response]', {
      dsid,
      failure,
      msg,
      is2FA,
      isBadLogin,
      rawText
    });

    return {
      ...parsed,
      _state: parsed.failureType ? 'failure' : 'success',
      require2FA: is2FA,
      isBadLogin,
      dsid,
      rawText
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

    const response = await this.fetch(url, {
      method: 'POST',
      body,
      headers: {
        ...this.Headers,
        'X-Dsid': Cookie.dsPersonId,
        'iCloud-DSID': Cookie.dsPersonId
      }
    });

    const parsed = plist.parse(await response.text());
    return {
      ...parsed,
      _state: parsed.failureType ? 'failure' : 'success'
    };
  }
}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);
Store.Headers = {
  'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
  'Content-Type': 'application/x-www-form-urlencoded'
};

export { Store };

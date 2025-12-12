import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';
import { CookieJar } from 'tough-cookie';

class Store {
  constructor() {
    this.cookieJar = new CookieJar();
    this.fetch = fetchCookie(nodeFetch, this.cookieJar);
    this.Headers = {
      'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }

  get guid() {
    return getMAC().replace(/:/g, '').toUpperCase();
  }

  async authenticate(email, password, mfa) {
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
      const parsedResp = plist.parse(await resp.text());
      return { ...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success' };
    } catch (e) {
      return { _state: 'failure', customerMessage: e.message || 'Connection error' };
    }
  }

  async download(appIdentifier, appVerId, Cookie) {
    const dataJson = {
      creditDisplay: '',
      guid: this.guid,
      salableAdamId: appIdentifier,
      ...(appVerId && { externalVersionId: appVerId })
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
      return { ...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success' };
    } catch (e) {
      return { _state: 'failure', customerMessage: e.message || 'Download error' };
    }
  }

  async purchase(bundleId, Cookie) {
    const dataJson = {
      guid: this.guid,
      salableAdamId: bundleId
    };
    const body = plist.build(dataJson);
    const url = `https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/buyProduct?guid=${this.guid}`;
    
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

  async purchaseHistory(Cookie) {
    const url = `https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/purchaseHistory`;
    const resp = await this.fetch(url, {
      method: 'POST',
      headers: {
        ...this.Headers,
        'X-Dsid': Cookie.dsPersonId,
        'iCloud-DSID': Cookie.dsPersonId
      }
    });
    const parsedResp = plist.parse(await resp.text());
    return parsedResp;
  }
}

export { Store };

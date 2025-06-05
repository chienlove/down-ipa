
import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
  static get guid() {
    return getMAC().replace(/:/g, '').toUpperCase();
  }

  /**
   * Xác thực Apple ID với mật khẩu và mã 2FA nếu có
   * @param {string} email
   * @param {string} password
   * @param {string} [mfa] - Mã 2FA nếu có
   * @returns {Promise<object>}
   */
  static async authenticate(email, password, mfa) {
    const dataJson = {
      appleId: email,
      attempt: mfa ? 2 : 4,
      createSession: 'true',
      guid: this.guid,
      password: mfa ? `${password}${mfa}` : password,
      rmp: 0,
      why: 'signIn',
    };
    const body = plist.build(dataJson);
    const url = `https://auth.itunes.apple.com/auth/v1/native/fast?guid=${this.guid}`;

    const resp = await this.fetch(url, {
      method: 'POST',
      body,
      headers: this.Headers,
    });

    const rawText = await resp.text();
    const parsedResp = plist.parse(rawText);

    const msg = (parsedResp.customerMessage || '').toLowerCase();
    const failure = (parsedResp.failureType || '').toLowerCase();
    const dsid = parsedResp.dsPersonId || 'unknown';

    const isBadLogin =
  msg.includes('badlogin') ||
  msg.includes('configurator') ||
  (!is2FA && dsid === 'unknown');

    const is2FA =
      msg.includes('code') ||
      msg.includes('two-factor') ||
      msg.includes('mfa') ||
      failure.includes('mfa');

    return {
      ...parsedResp,
      _state: parsedResp.failureType ? 'failure' : 'success',
      require2FA: is2FA,
      isBadLogin,
      dsid,
      rawText
    };
  }

  /**
   * Tải thông tin và URL IPA từ App Store
   * @param {string} appIdentifier - ID của ứng dụng
   * @param {string} appVerId - (tuỳ chọn) phiên bản
   * @param {object} Cookie - Cookie / token đã xác thực
   * @returns {Promise<object>}
   */
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
    return {
      ...parsedResp,
      _state: parsedResp.failureType ? 'failure' : 'success'
    };
  }
}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);
Store.Headers = {
  'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
  'Content-Type': 'application/x-www-form-urlencoded',
};

export { Store };

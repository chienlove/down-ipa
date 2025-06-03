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

    const text = await resp.text();
    const parsedResp = plist.parse(text);

    const cookieHeader = resp.headers.raw()['set-cookie']?.join('; ') || '';

    const result = {
      ...parsedResp,
      _state: 'success',
      rawText: text
    };

    // Print core response fields
    if (!parsedResp.sessionId && !parsedResp['x-apple-id-session-id']) {
      throw new Error('❌ No sessionId returned — likely invalid login.\nResponse: ' + text);
    }

    if (result._state === 'success' && !mfa) {
      const trustedCheck = await this.check2FARequirement(parsedResp, cookieHeader);

      result.debugTrusted = trustedCheck;

      if (trustedCheck === 'NEEDS_2FA') {
        result._state = 'failure';
        result.failureType = 'missingTwoFactorCode';
        result.customerMessage = '🔐 Thiếu mã xác minh 2FA';
      } else if (trustedCheck === 'INVALID_2FA') {
        result._state = 'failure';
        result.failureType = 'invalidTwoFactorCode';
        result.customerMessage = '❌ Sai mã xác minh 2FA';
      } else if (trustedCheck === 'LOGIN_FAILED') {
        result._state = 'failure';
        result.failureType = 'invalid_credentials';
        result.customerMessage = '❌ Sai Apple ID hoặc mật khẩu';
      }
    }

    return result;
  }

  static async check2FARequirement(parsedResp, cookieHeader) {
    try {
      const sessionId = parsedResp.sessionId;
      const scnt = parsedResp.scnt;

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

      const status = resp.status;
      const bodyText = await resp.text();

      throw new Error('📦 TrustedDevice DEBUG\nStatus: ' + status + '\nBody: ' + bodyText);
    } catch (err) {
      throw new Error('check2FARequirement error: ' + err.message);
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

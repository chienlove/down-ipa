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

    // ✅ Xác định trạng thái đúng: đăng nhập thường, 2FA, hoặc sai
    let _state = 'failure';

    if (parsedResp.authOptions && parsedResp.authType === 'hsa2') {
      _state = 'requires2FA';
    } else if (
      parsedResp.customerMessage === 'MZFinance.BadLogin.Configurator_message' &&
      !parsedResp.failureType
    ) {
      // Apple trả "BadLogin" nhưng không có failureType → là tài khoản đúng, cần 2FA
      _state = 'requires2FA';
    } else if (parsedResp.accountInfo?.address?.firstName) {
      _state = 'success';
    }

    // ✅ In log để debug nếu cần
    console.log('[DEBUG] Apple parsed response:', JSON.stringify(parsedResp, null, 2));
    console.log('[DEBUG] Determined _state:', _state);

    // ✅ Trả về kết quả dạng JSON thuần để không mất _state
    return JSON.parse(JSON.stringify({ ...parsedResp, _state }));
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
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

    const result = {
      ...parsedResp,
      _state: 'success',
      rawText: text
    };

    const failureType = parsedResp.failureType?.trim() || '';
    const customerMessage = parsedResp.customerMessage || '';

    // Analyze based on failureType, same as Swift logic
    if (failureType !== '') {
      result._state = 'failure';
      result.failureType = failureType;

      if (failureType === 'InvalidCredentials') {
        result.customerMessage = '❌ Sai Apple ID hoặc mật khẩu';
      } else if (failureType === 'MissingTrustedDeviceResponse' || failureType === 'MissingSecondaryLoginToken') {
        result.customerMessage = '🔐 Yêu cầu mã xác minh 2FA';
      } else if (failureType === 'InvalidSecondaryLoginToken') {
        result.customerMessage = '❌ Sai mã xác minh 2FA';
      } else {
        result.customerMessage = `⚠️ Lỗi không xác định: ${failureType}`;
      }

      return result;
    }

    // Success case (no failureType)
    if (parsedResp.adamId || parsedResp.sessionId || parsedResp['x-apple-id-session-id']) {
      result._state = 'success';
      return result;
    }

    // Fallback if failureType missing but known bad login message
    if (customerMessage === 'MZFinance.BadLogin.Configurator_message') {
      result._state = 'failure';
      result.failureType = 'InvalidCredentials';
      result.customerMessage = '❌ Sai Apple ID hoặc mật khẩu';
      return result;
    }

    // Unknown fallback
    result._state = 'failure';
    result.failureType = 'Unknown';
    result.customerMessage = '⚠️ Không rõ trạng thái đăng nhập';
    return result;
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
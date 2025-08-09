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
      }
    });
    const parsedResp = plist.parse(await resp.text());
    return { ...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success' };
  }

  static async purchase(adamId, Cookie) {
  const base = 'https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa';
  const url1 = `${base}/buyProduct?guid=${this.guid}`;
  const MAX_FOLLOWS = 5;

  // Cấu hình quan trọng
  const storeFront = '143441-1,32'; // Storefront US (thử cả VN '143471-1,32' nếu không work)
  const headers = {
    ...this.Headers,
    'X-Dsid': Cookie.dsPersonId,
    'iCloud-DSID': Cookie.dsPersonId,
    'X-Apple-Store-Front': storeFront,
    'Accept': '*/*',
    'Accept-Language': 'en-us,en;q=0.9'
  };

  // Bước 1: Gửi yêu cầu ban đầu
  const firstBody = plist.build({
    guid: this.guid,
    salableAdamId: adamId,
    ageCheck: true,
    hasBeenAuthedForBuy: true,
    isInApp: false
  });

  let response = await this.fetch(url1, {
    method: 'POST',
    body: firstBody,
    headers: { ...headers, 'Content-Type': 'application/x-apple-plist' }
  });

  let data = plist.parse(await response.text());

  // Xử lý trường hợp thành công ngay
  if (!data.failureType && !data.dialog) {
    return { ...data, _state: 'success' };
  }

  // Xử lý lỗi 2060 - Sign-In Required
  if (data.failureType === '2060') {
    // Tạo URL và params cho request tiếp theo
    const actionUrl = data.metrics.actionUrl.startsWith('http') 
      ? data.metrics.actionUrl 
      : `https://${data.metrics.actionUrl}`;
    
    const buyParams = new URLSearchParams();
    buyParams.append('salableAdamId', adamId);
    buyParams.append('guid', this.guid);
    buyParams.append('hasBeenAuthedForBuy', 'true');
    buyParams.append('isInApp', 'false');
    buyParams.append('ageCheck', 'true');

    // Gửi request xác minh
    response = await this.fetch(actionUrl, {
      method: 'POST',
      body: buyParams.toString(),
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    data = plist.parse(await response.text());
  }

  // Kiểm tra kết quả cuối cùng
  if (data.failureType) {
    return { 
      ...data, 
      _state: 'failure',
      requiresAgeVerification: data.failureType === '2060'
    };
  }

  return { ...data, _state: 'success' };
}

  static async purchaseHistory(Cookie) {
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

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);
Store.Headers = {
  'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
  'Content-Type': 'application/x-www-form-urlencoded',
};

export { Store };

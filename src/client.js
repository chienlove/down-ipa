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

  // BƯỚC 1: gửi plist để Apple trả dialog
  const firstBody = plist.build({ guid: this.guid, salableAdamId: adamId });
  const headers1 = {
    ...this.Headers,
    'Content-Type': 'application/x-apple-plist', // plist ở bước 1
    'X-Dsid': Cookie.dsPersonId,
    'iCloud-DSID': Cookie.dsPersonId,
    'Accept': '*/*',
    'Accept-Language': 'en-us,en;q=0.9'
  };

  const resp1 = await this.fetch(url1, { method: 'POST', body: firstBody, headers: headers1 });
  const text1 = await resp1.text();

  let data1;
  try { data1 = plist.parse(text1); }
  catch (e) { console.error('purchase step1 parse error:', text1); throw e; }

  // Nếu thành công ngay (không có dialog), trả luôn
  if (!data1?.failureType && !data1?.dialog) {
    return { ...data1, _state: 'success' };
  }

  // Có dialog 2060 -> lấy buyParams để "bấm Buy" lần 2
  const buyParams = data1?.dialog?.okButtonAction?.buyParams;
  const actionUrl = data1?.metrics?.actionUrl
    ? `https://${String(data1.metrics.actionUrl).replace(/^https?:\/\//, '')}`
    : url1;

  if (!buyParams) {
    // Không có buyParams -> trả lại để UI hiển thị thông báo
    return { ...data1, _state: 'failure' };
  }

  const headers2 = {
    ...this.Headers,
    'Content-Type': 'application/x-www-form-urlencoded', // form ở bước 2
    'X-Dsid': Cookie.dsPersonId,
    'iCloud-DSID': Cookie.dsPersonId,
    'Accept': '*/*',
    'Accept-Language': 'en-us,en;q=0.9'
  };

  console.log('purchase step2 POST ->', actionUrl, 'params=', buyParams);

  // BƯỚC 2: POST lại y nguyên buyParams
  const resp2 = await this.fetch(actionUrl, { method: 'POST', body: buyParams, headers: headers2 });
  const text2 = await resp2.text();

  let data2;
  try { data2 = plist.parse(text2); }
  catch (e) { console.error('purchase step2 parse error:', text2); throw e; }

  return { ...data2, _state: data2.failureType ? 'failure' : 'success' };
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

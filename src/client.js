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

  // STEP 1: gửi plist để Apple trả dialog
  const firstBody = plist.build({ guid: this.guid, salableAdamId: adamId });
  const headers1 = {
    ...this.Headers,
    'Content-Type': 'application/x-apple-plist',
    'X-Dsid': Cookie.dsPersonId,
    'iCloud-DSID': Cookie.dsPersonId,
    'Accept': '*/*',
    'Accept-Language': 'en-us,en;q=0.9'
  };
  const resp1 = await this.fetch(url1, { method: 'POST', body: firstBody, headers: headers1 });
  const text1 = await resp1.text();

  let data;
  try { data = plist.parse(text1); }
  catch (e) { console.error('purchase step1 parse error:', text1); throw e; }

  if (!data?.failureType && !data?.dialog) {
    return { ...data, _state: 'success' };
  }

  // Chuẩn bị BƯỚC 2+ (form-urlencoded)
  const headers2 = {
    ...this.Headers,
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Dsid': Cookie.dsPersonId,
    'iCloud-DSID': Cookie.dsPersonId,
    'Accept': '*/*',
    'Accept-Language': 'en-us,en;q=0.9',
    'Referer': `${base}/buyProduct`
  };
  const storeFront = process.env.APPLE_STOREFRONT; // vd: '143471-1,32' (VN) hoặc '143441-1,32' (US)
  if (storeFront) headers2['X-Apple-Store-Front'] = storeFront;

  let params = data?.dialog?.okButtonAction?.buyParams || null;
  let followUrl = data?.metrics?.actionUrl
    ? `https://${String(data.metrics.actionUrl).replace(/^https?:\/\//, '')}`
    : url1;

  // FOLLOW-UP: lặp tối đa 3 lần nếu còn dialog
  for (let i = 0; i < 3 && params; i++) {
    console.log(`purchase follow #${i+1} ->`, followUrl, 'params=', params);
    const r = await this.fetch(followUrl, { method: 'POST', body: params, headers: headers2 });
    const t = await r.text();

    try { data = plist.parse(t); }
    catch (e) { console.error('purchase follow parse error:', t); throw e; }

    if (!data?.failureType && !data?.dialog) {
      return { ...data, _state: 'success' };
    }

    // nếu vẫn dialog, lấy buyParams kế tiếp (nếu có) và tiếp tục
    params = data?.dialog?.okButtonAction?.buyParams || null;
    followUrl = data?.metrics?.actionUrl
      ? `https://${String(data.metrics.actionUrl).replace(/^https?:\/\//, '')}`
      : followUrl;
  }

  // Hết vòng vẫn dialog/failure → trả về cho client hiển thị
  return { ...data, _state: data?.failureType ? 'failure' : 'success' };
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

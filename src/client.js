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
  const MAX_FOLLOWS = Number(process.env.PURCHASE_MAX_FOLLOWS || 5);

  // === CẤU HÌNH STOREFRONT (QUAN TRỌNG) ===
  // Storefront US: '143441-1,32' | Storefront VN: '143471-1,32'
  const storeFront = '143471-1,32'; // Mặc định dành cho tài khoản Việt Nam

  // === STEP 1: GỬI YÊU CẦU BAN ĐẦU ===
  const firstBody = plist.build({
    guid: this.guid,
    salableAdamId: adamId,
    ageCheck: true, // Bật kiểm tra tuổi
    hasBeenAuthedForBuy: true // Xác nhận đã đăng nhập
  });

  const headers1 = {
    ...this.Headers,
    'Content-Type': 'application/x-apple-plist',
    'X-Dsid': Cookie.dsPersonId,
    'iCloud-DSID': Cookie.dsPersonId,
    'X-Apple-Store-Front': storeFront, // Thêm storefront
    'Accept': '*/*',
    'Accept-Language': 'en-us,en;q=0.9'
  };

  console.log('[purchase] step1 POST ->', url1, 'adamId=', adamId);
  const resp1 = await this.fetch(url1, { method: 'POST', body: firstBody, headers: headers1 });
  const text1 = await resp1.text();

  let data;
  try {
    data = plist.parse(text1);
  } catch (e) {
    console.error('[purchase] step1 parse error (raw):', text1);
    throw new Error('Không thể phân tích phản hồi từ Apple');
  }

  // === XỬ LÝ THÀNH CÔNG NGAY LẦN ĐẦU ===
  if (!data?.failureType && !data?.dialog) {
    console.log('[purchase] step1 success (no dialog).');
    return { ...data, _state: 'success' };
  }

  // === STEP 2: CHUẨN BỊ HEADER CHO CÁC REQUEST TIẾP THEO ===
  const headers2 = {
    ...this.Headers,
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Dsid': Cookie.dsPersonId,
    'iCloud-DSID': Cookie.dsPersonId,
    'X-Apple-Store-Front': storeFront, // Giữ nguyên storefront
    'Accept': '*/*',
    'Accept-Language': 'en-us,en;q=0.9',
    'Referer': `${base}/buyProduct`
  };

  let params = data?.dialog?.okButtonAction?.buyParams || null;
  let followUrl = data?.metrics?.actionUrl
    ? `https://${String(data.metrics.actionUrl).replace(/^https?:\/\//, '')}`
    : url1;

  // === XỬ LÝ ĐẶC BIỆT CHO LỖI 2060 (SIGN-IN REQUIRED) ===
  if (data?.failureType === '2060' && data?.dialog?.okButtonAction?.buyParams) {
    console.log('[purchase] Handling Sign-In Required dialog (2060)');
    params = data.dialog.okButtonAction.buyParams;
    followUrl = `https://${data.metrics.actionUrl.replace(/^https?:\/\//, '')}`;
  }

  // === FOLLOW LOOP: XỬ LÝ CÁC BƯỚC TIẾP THEO ===
  for (let i = 0; i < MAX_FOLLOWS && params; i++) {
    console.log(`[purchase] follow #${i + 1} ->`, followUrl, 'params=', params);

    const r = await this.fetch(followUrl, { method: 'POST', body: params, headers: headers2 });
    const t = await r.text();

    try {
      data = plist.parse(t);
    } catch (e) {
      console.error('[purchase] follow parse error (raw):', t);
      throw new Error('Phản hồi không hợp lệ từ Apple');
    }

    // THÀNH CÔNG: KHÔNG CÒN DIALOG HOẶC LỖI
    if (!data?.failureType && !data?.dialog) {
      console.log('[purchase] success after follow.');
      return { ...data, _state: 'success' };
    }

    // TIẾP TỤC XỬ LÝ NẾU CÓ DIALOG MỚI
    const nextParams = data?.dialog?.okButtonAction?.buyParams || null;
    const nextUrl = data?.metrics?.actionUrl
      ? `https://${String(data.metrics.actionUrl).replace(/^https?:\/\//, '')}`
      : followUrl;

    params = nextParams;
    followUrl = nextUrl;
  }

  // === TRẢ VỀ LỖI NẾU VẪN THẤT BẠI SAU MAX_FOLLOWS ===
  console.warn('[purchase] finished follows, still failure/dialog. Returning last response.');
  return { 
    ...data, 
    _state: data?.failureType ? 'failure' : 'success',
    requiresAgeVerification: data?.failureType === '2060' // Cờ xác minh tuổi
  };
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

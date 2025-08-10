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
  const entryUrl = `${base}/buyProduct?guid=${this.guid}`;
  const MAX_FOLLOWS = 5;

  const commonHeaders = {
    ...this.Headers,
    'Accept': '*/*',
    'Accept-Language': 'en-us,en;q=0.9',
    // KHÔNG set X-Apple-Store-Front cứng nữa; để Apple tự xác định theo tài khoản
    'X-Dsid': Cookie.dsPersonId,
    'iCloud-DSID': Cookie.dsPersonId,
  };

  const makePlistBody = () => plist.build({
    guid: this.guid,
    salableAdamId: adamId,
    ageCheck: true,
    hasBeenAuthedForBuy: true,
    isInApp: false,
  });

  // Helper: POST form-encoded tới actionUrl với đúng buyParams trả về từ dialog
  const postBuyParams = async (actionUrl, buyParamsString) => {
    // actionUrl có thể là host trần "p25-buy.itunes..." → chuẩn hoá https://
    const finalUrl = actionUrl.startsWith('http') ? actionUrl : `https://${actionUrl}`;
    return this.fetch(finalUrl, {
      method: 'POST',
      headers: { ...commonHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buyParamsString,
    });
  };

  // B1: request khởi tạo
  let resp = await this.fetch(entryUrl, {
    method: 'POST',
    headers: { ...commonHeaders, 'Content-Type': 'application/x-apple-plist' },
    body: makePlistBody(),
  });

  let data = plist.parse(await resp.text());
  if (!data.failureType && !data.dialog) {
    return { ...data, _state: 'success' };
  }

  // B2: follow tối đa MAX_FOLLOWS lần theo dialog/actionUrl/buyParams
  for (let i = 0; i < MAX_FOLLOWS; i++) {
    // Trường hợp Apple yêu cầu Sign-In/AgeCheck qua dialog authorization
    const dialog = data.dialog || null;
    const metrics = data.metrics || {};
    let followed = false;

    if (dialog?.okButtonAction?.kind === 'Buy' && dialog?.okButtonAction?.buyParams) {
      // Follow bằng chính buyParams mà Apple trả về
      resp = await postBuyParams(metrics.actionUrl || 'p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/buyProduct',
                                 dialog.okButtonAction.buyParams);
      data = plist.parse(await resp.text());
      followed = true;
    } else if (metrics?.actionUrl) {
      // Một số case không có okButtonAction nhưng có metrics.actionUrl + cần buyParams tối thiểu
      const bp = new URLSearchParams();
      bp.append('salableAdamId', adamId);
      bp.append('guid', this.guid);
      bp.append('hasBeenAuthedForBuy', 'true');
      bp.append('isInApp', 'false');
      bp.append('ageCheck', 'true');
      resp = await postBuyParams(metrics.actionUrl, bp.toString());
      data = plist.parse(await resp.text());
      followed = true;
    } else if (data.failureType === '2060') {
      // Dự phòng: tự gửi lại buyProduct với form-encoded params
      const bp = new URLSearchParams();
      bp.append('salableAdamId', adamId);
      bp.append('guid', this.guid);
      bp.append('hasBeenAuthedForBuy', 'true');
      bp.append('isInApp', 'false');
      bp.append('ageCheck', 'true');
      resp = await postBuyParams('p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/buyProduct', bp.toString());
      data = plist.parse(await resp.text());
      followed = true;
    }

    // Nếu đã follow một bước, kiểm tra trạng thái
    if (followed) {
      if (!data.failureType && !data.dialog) {
        return { ...data, _state: 'success' };
      }
      // nếu vẫn còn dialog/failureType → vòng lặp sẽ tiếp tục follow
      continue;
    }

    // Không có gì để follow nữa → dừng
    break;
  }

  // Nếu tới đây mà vẫn lỗi
  if (data.failureType) {
    return {
      ...data,
      _state: 'failure',
      requiresAgeVerification: data.failureType === '2060',
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
  'X-Apple-I-Client-Time': new Date().toISOString(),
  'X-Apple-I-TimeZone': Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok',
};

export { Store };

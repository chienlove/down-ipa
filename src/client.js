// client.js — FIX 2060: bỏ Store-Front cứng + follow đúng buyParams, thêm time headers

import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
  static get guid() {
    return getMAC().replace(/:/g, '').toUpperCase();
  }

  // ---- Header động mỗi request (thêm time & timezone). KHÔNG set Store-Front cứng.
  static dynHeaders(extra = {}) {
    let tz = 'Asia/Bangkok';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
    } catch {}
    return {
      'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
      'Accept': '*/*',
      'Accept-Language': 'en-us,en;q=0.9',
      'X-Apple-I-Client-Time': new Date().toISOString(),
      'X-Apple-I-TimeZone': tz,
      ...extra,
    };
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
      headers: this.dynHeaders({ 'Content-Type': 'application/x-apple-plist' }),
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
      headers: this.dynHeaders({
        'Content-Type': 'application/x-apple-plist',
        'X-Dsid': Cookie.dsPersonId,
        'iCloud-DSID': Cookie.dsPersonId,
      }),
    });
    const parsedResp = plist.parse(await resp.text());
    return { ...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success' };
  }

  static async purchase(adamId, Cookie) {
    const base = 'https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa';
    const entryUrl = `${base}/buyProduct?guid=${this.guid}`;
    const MAX_FOLLOWS = 6;

    const authHeaders = {
      'X-Dsid': Cookie.dsPersonId,
      'iCloud-DSID': Cookie.dsPersonId,
    };

    const normalizeUrl = (u) => (u?.startsWith('http') ? u : (u ? `https://${u}` : `${base}/buyProduct`));

    const postForm = async (actionUrl, formBody) => {
      return this.fetch(normalizeUrl(actionUrl), {
        method: 'POST',
        headers: this.dynHeaders({ ...authHeaders, 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: formBody,
      });
    };

    // B1: request khởi tạo (PLIST)
    const firstBody = plist.build({
      guid: this.guid,
      salableAdamId: adamId,
      ageCheck: true,
      hasBeenAuthedForBuy: true,
      isInApp: false,
    });

    let resp = await this.fetch(entryUrl, {
      method: 'POST',
      headers: this.dynHeaders({ ...authHeaders, 'Content-Type': 'application/x-apple-plist' }),
      body: firstBody,
    });

    let dataText = await resp.text();
    let data = plist.parse(dataText);

    if (!data.failureType && !data.dialog) {
      return { ...data, _state: 'success' };
    }

    // B2: follow dialog nhiều bước — ƯU TIÊN dùng exact buyParams Apple trả
    for (let i = 0; i < MAX_FOLLOWS; i++) {
      const dialog = data.dialog || null;
      const metrics = data.metrics || {};
      let followed = false;

      if (dialog?.okButtonAction?.kind === 'Buy' && dialog?.okButtonAction?.buyParams) {
        resp = await postForm(metrics.actionUrl || 'p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/buyProduct',
                              dialog.okButtonAction.buyParams);
        data = plist.parse(await resp.text());
        followed = true;
      } else if (metrics?.actionUrl) {
        // Dự phòng nếu không có okButtonAction
        const bp = new URLSearchParams();
        bp.append('salableAdamId', adamId);
        bp.append('guid', this.guid);
        bp.append('hasBeenAuthedForBuy', 'true');
        bp.append('isInApp', 'false');
        bp.append('ageCheck', 'true');
        resp = await postForm(metrics.actionUrl, bp.toString());
        data = plist.parse(await resp.text());
        followed = true;
      } else if (data.failureType === '2060') {
        // Dự phòng bổ sung
        const bp = new URLSearchParams();
        bp.append('salableAdamId', adamId);
        bp.append('guid', this.guid);
        bp.append('hasBeenAuthedForBuy', 'true');
        bp.append('isInApp', 'false');
        bp.append('ageCheck', 'true');
        resp = await postForm('p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/buyProduct', bp.toString());
        data = plist.parse(await resp.text());
        followed = true;
      }

      if (followed) {
        if (!data.failureType && !data.dialog) {
          return { ...data, _state: 'success' };
        }
        continue;
      }
      break;
    }

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
      headers: this.dynHeaders({
        'X-Dsid': Cookie.dsPersonId,
        'iCloud-DSID': Cookie.dsPersonId,
      }),
    });
    const parsedResp = plist.parse(await resp.text());
    return parsedResp;
  }
}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);

// Store.Headers KHÔNG còn dùng cứng cho mọi request; để tương thích chỗ cũ nếu gọi:
Store.Headers = Store.dynHeaders();

export { Store };
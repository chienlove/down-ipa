import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
  static get guid() {
    return getMAC().replace(/:/g, '').toUpperCase();
  }

  // ===== Headers động mỗi request (tránh lệch giờ & timezone) =====
  static dynHeaders(extra = {}) {
    let tz = 'Asia/Bangkok';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch {}
    return {
      'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
      'Accept': '*/*',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'X-Apple-I-Client-Time': new Date().toISOString(),
      'X-Apple-I-TimeZone': tz,
      ...extra
    };
  }

  // Wrapper fetch có cookie jar
  static async fetch(url, opts) { return Store._fetch(url, opts); }

  // ===== Phát hiện Storefront của tài khoản (cache 15 phút) =====
  static async detectStorefront() {
    if (this._storefront && Date.now() - (this._sfAt || 0) < 15 * 60 * 1000) return this._storefront;
    const url = 'https://itunes.apple.com/WebObjects/MZStore.woa/wa/storeFront';
    const resp = await this.fetch(url, { method: 'GET', headers: this.dynHeaders() });
    const sf = resp.headers?.get?.('x-apple-store-front');
    if (sf) {
      // thường dạng "143471-1,32;...": chỉ lấy phần trước dấu ;
      this._storefront = sf.split(';')[0].trim();
      this._sfAt = Date.now();
      return this._storefront;
    }
    return null;
  }

  static get lastStorefront() { return this._storefront || null; }

  /* ==================== AUTH ==================== */
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
      headers: this.dynHeaders({ 'Content-Type': 'application/x-apple-plist' })
    });
    const parsedResp = plist.parse(await resp.text());
    return { ...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success' };
  }

  /* ==================== DOWNLOAD TICKET ==================== */
  static async download(appIdentifier, appVerId, Cookie) {
    const dataJson = {
      creditDisplay: '',
      guid: this.guid,
      salableAdamId: appIdentifier,
      ...(appVerId && { externalVersionId: appVerId })
    };
    const body = plist.build(dataJson);

    // GẮN storefront đã phát hiện (nếu có)
    const storefront = await this.detectStorefront();

    const url = `https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/volumeStoreDownloadProduct?guid=${this.guid}`;
    const resp = await this.fetch(url, {
      method: 'POST',
      body,
      headers: this.dynHeaders({
        'Content-Type': 'application/x-apple-plist',
        'X-Dsid': Cookie.dsPersonId,
        'iCloud-DSID': Cookie.dsPersonId,
        ...(storefront ? { 'X-Apple-Store-Front': storefront } : {})
      }),
    });
    const parsedResp = plist.parse(await resp.text());
    return { ...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success' };
  }

  /* ==================== PURCHASE ==================== */
  static async purchase(adamId, Cookie) {
    const base = 'https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa';
    const entryUrl = `${base}/buyProduct?guid=${this.guid}`;
    const MAX_FOLLOWS = 6;

    // Tự phát hiện storefront rồi luôn gắn vào headers
    const storefront = await this.detectStorefront();

    const commonAuth = {
      'X-Dsid': Cookie.dsPersonId,
      'iCloud-DSID': Cookie.dsPersonId,
      ...(storefront ? { 'X-Apple-Store-Front': storefront } : {})
    };

    const normalize = (u) => (u?.startsWith('http') ? u : (u ? `https://${u}` : `${base}/buyProduct`));

    const postForm = async (actionUrl, formBody) => {
      return this.fetch(normalize(actionUrl), {
        method: 'POST',
        headers: this.dynHeaders({ ...commonAuth, 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: formBody
      });
    };

    // B1: khởi tạo (PLIST)
    const firstBody = plist.build({
      guid: this.guid,
      salableAdamId: adamId,
      ageCheck: true,
      hasBeenAuthedForBuy: true,
      isInApp: false
    });
    let resp = await this.fetch(entryUrl, {
      method: 'POST',
      headers: this.dynHeaders({ ...commonAuth, 'Content-Type': 'application/x-apple-plist' }),
      body: firstBody
    });
    let data = plist.parse(await resp.text());
    if (!data.failureType && !data.dialog) return { ...data, _state: 'success', storefrontUsed: storefront || null };

    // B2: follow dialog/buyParams
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
          return { ...data, _state: 'success', storefrontUsed: storefront || null };
        }
        continue;
      }
      break;
    }

    if (data.failureType) {
      const isFamilyAge = data.metrics?.dialogId === 'MZCommerce.FamilyAgeCheck';
      return {
        ...data,
        _state: 'failure',
        storefrontUsed: storefront || null,
        failureCode: isFamilyAge ? 'ACCOUNT_FAMILY_AGE_CHECK' : data.failureType,
        customerMessage: isFamilyAge
          ? 'Apple yêu cầu xác minh Family/Age hoặc khởi tạo mua hàng trên App Store. Hãy mở App Store, đăng nhập, tải 1 app miễn phí trong đúng quốc gia, hoặc tắt Ask To Buy.'
          : (data.customerMessage || 'Purchase failed')
      };
    }
    return { ...data, _state: 'success', storefrontUsed: storefront || null };
  }

  static async purchaseHistory(Cookie) {
    const storefront = await this.detectStorefront();
    const url = `https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/purchaseHistory`;
    const resp = await this.fetch(url, {
      method: 'POST',
      headers: this.dynHeaders({
        'X-Dsid': Cookie.dsPersonId,
        'iCloud-DSID': Cookie.dsPersonId,
        ...(storefront ? { 'X-Apple-Store-Front': storefront } : {})
      })
    });
    const parsedResp = plist.parse(await resp.text());
    return parsedResp;
  }
}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store._fetch = fetchCookie(nodeFetch, Store.cookieJar);

// Giữ cho tương thích code cũ (nếu nơi nào lỡ dùng Store.Headers)
Store.Headers = Store.dynHeaders();

export { Store };
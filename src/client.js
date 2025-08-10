import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
  static get guid() {
    return getMAC().replace(/:/g, '').toUpperCase();
  }

  // Header động mỗi request (tránh lệch giờ)
  static dynHeaders(extra = {}) {
    let tz = 'Asia/Bangkok';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch {}
    return {
      'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
      'Accept': '*/*',
      'Accept-Language': 'en-us,en;q=0.9',
      'X-Apple-I-Client-Time': new Date().toISOString(),
      'X-Apple-I-TimeZone': tz,
      ...extra
    };
  }

  // Wrapper fetch có cookie jar
  static async fetch(url, opts) { return Store._fetch(url, opts); }

  /* ==================== AUTH ==================== */
  static async authenticate(email, password, mfa, { debug = false } = {}) {
    const steps = [];
    const add = (obj) => debug && steps.push(obj);

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

    add({ step: 'auth:init', url, method: 'POST',
      req: { ct: 'application/x-apple-plist' } });

    const resp = await this.fetch(url, {
      method: 'POST',
      body,
      headers: this.dynHeaders({ 'Content-Type': 'application/x-apple-plist' })
    });
    const text = await resp.text();
    let parsedResp = {};
    try { parsedResp = plist.parse(text); } catch { parsedResp = { parseError: true, text: text?.slice(0, 4000) }; }

    add({ step: 'auth:resp', status: resp.status,
      resp: {
        keys: Object.keys(parsedResp || {}),
        failureType: parsedResp.failureType,
        customerMessage: parsedResp.customerMessage,
      }
    });

    const res = { ...parsedResp, _state: parsedResp.failureType ? 'failure' : 'success' };
    if (debug) res._debug = { guid: this.guid, steps };
    return res;
  }

  /* ==================== DOWNLOAD TICKET ==================== */
  static async download(appIdentifier, appVerId, Cookie, { debug = false } = {}) {
    const steps = [];
    const add = (obj) => debug && steps.push(obj);

    const dataJson = {
      creditDisplay: '',
      guid: this.guid,
      salableAdamId: appIdentifier,
      ...(appVerId && { externalVersionId: appVerId })
    };
    const body = plist.build(dataJson);
    const url = `https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/volumeStoreDownloadProduct?guid=${this.guid}`;

    const hdrs = this.dynHeaders({
      'Content-Type': 'application/x-apple-plist',
      'X-Dsid': Cookie.dsPersonId,
      'iCloud-DSID': Cookie.dsPersonId
    });

    add({ step: 'download:init', url, method: 'POST',
      req: { ct: hdrs['Content-Type'], XDsid: hdrs['X-Dsid'], iCloudDSID: hdrs['iCloud-DSID'] } });

    const resp = await this.fetch(url, { method: 'POST', body, headers: hdrs });
    const text = await resp.text();
    let parsed = {};
    try { parsed = plist.parse(text); } catch { parsed = { parseError: true, text: text?.slice(0, 4000) }; }

    add({ step: 'download:resp', status: resp.status,
      resp: {
        keys: Object.keys(parsed || {}),
        failureType: parsed.failureType,
        customerMessage: parsed.customerMessage,
      }
    });

    const res = { ...parsed, _state: parsed.failureType ? 'failure' : 'success' };
    if (debug) res._debug = { guid: this.guid, steps };
    return res;
  }

  /* ==================== PURCHASE ==================== */
  static async purchase(adamId, Cookie, { debug = false, storefront = null } = {}) {
    const steps = [];
    const add = (obj) => debug && steps.push(obj);

    const base = 'https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa';
    const entryUrl = `${base}/buyProduct?guid=${this.guid}`;
    const MAX_FOLLOWS = 6;

    const commonAuth = {
      'X-Dsid': Cookie.dsPersonId,
      'iCloud-DSID': Cookie.dsPersonId,
      ...(storefront ? { 'X-Apple-Store-Front': storefront } : {})
    };

    const normalize = (u) => (u?.startsWith('http') ? u : (u ? `https://${u}` : `${base}/buyProduct`));

    const postForm = async (actionUrl, formBody, tag) => {
      const url = normalize(actionUrl);
      const hdrs = this.dynHeaders({ ...commonAuth, 'Content-Type': 'application/x-www-form-urlencoded' });
      add({ step: `purchase:${tag}:postForm`, url, method: 'POST',
        req: {
          ct: hdrs['Content-Type'],
          XDsid: hdrs['X-Dsid'],
          iCloudDSID: hdrs['iCloud-DSID'],
          storefront: hdrs['X-Apple-Store-Front'] || null,
          bodyPreview: String(formBody).slice(0, 300)
        } });
      const resp = await this.fetch(url, { method: 'POST', headers: hdrs, body: formBody });
      const text = await resp.text();
      let parsed = {};
      try { parsed = plist.parse(text); } catch { parsed = { parseError: true, text: text?.slice(0, 4000) }; }
      add({ step: `purchase:${tag}:resp`, status: resp.status,
        resp: {
          keys: Object.keys(parsed || {}),
          failureType: parsed.failureType,
          customerMessage: parsed.customerMessage,
          dialogId: parsed.metrics?.dialogId,
          actionUrl: parsed.metrics?.actionUrl,
          hasDialog: !!parsed.dialog,
          hasBuyParams: !!parsed.dialog?.okButtonAction?.buyParams
        } });
      return parsed;
    };

    // B1: init (PLIST)
    const initHdrs = this.dynHeaders({ ...commonAuth, 'Content-Type': 'application/x-apple-plist' });
    const initBody = plist.build({
      guid: this.guid,
      salableAdamId: adamId,
      ageCheck: true,
      hasBeenAuthedForBuy: true,
      isInApp: false
    });

    add({ step: 'purchase:init', url: entryUrl, method: 'POST',
      req: {
        ct: initHdrs['Content-Type'],
        XDsid: initHdrs['X-Dsid'],
        iCloudDSID: initHdrs['iCloud-DSID'],
        storefront: initHdrs['X-Apple-Store-Front'] || null
      } });

    let resp = await this.fetch(entryUrl, { method: 'POST', headers: initHdrs, body: initBody });
    let text = await resp.text();
    let data = {};
    try { data = plist.parse(text); } catch { data = { parseError: true, text: text?.slice(0, 4000) }; }

    add({ step: 'purchase:init:resp', status: resp.status,
      resp: {
        keys: Object.keys(data || {}),
        failureType: data.failureType,
        customerMessage: data.customerMessage,
        dialogId: data.metrics?.dialogId,
        actionUrl: data.metrics?.actionUrl,
        hasDialog: !!data.dialog,
        hasBuyParams: !!data.dialog?.okButtonAction?.buyParams
      } });

    if (!data.failureType && !data.dialog) {
      const out = { ...data, _state: 'success' };
      if (debug) out._debug = { guid: this.guid, steps };
      return out;
    }

    // B2: follow nhiều bước
    for (let i = 0; i < MAX_FOLLOWS; i++) {
      const dialog = data.dialog || null;
      const metrics = data.metrics || {};
      let followed = false;

      if (dialog?.okButtonAction?.kind === 'Buy' && dialog?.okButtonAction?.buyParams) {
        data = await postForm(metrics.actionUrl || 'p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/buyProduct',
                              dialog.okButtonAction.buyParams, `follow${i}-okBtn`);
        followed = true;
      } else if (metrics?.actionUrl) {
        const bp = new URLSearchParams();
        bp.append('salableAdamId', adamId);
        bp.append('guid', this.guid);
        bp.append('hasBeenAuthedForBuy', 'true');
        bp.append('isInApp', 'false');
        bp.append('ageCheck', 'true');
        data = await postForm(metrics.actionUrl, bp.toString(), `follow${i}-metrics`);
        followed = true;
      } else if (data.failureType === '2060') {
        const bp = new URLSearchParams();
        bp.append('salableAdamId', adamId);
        bp.append('guid', this.guid);
        bp.append('hasBeenAuthedForBuy', 'true');
        bp.append('isInApp', 'false');
        bp.append('ageCheck', 'true');
        data = await postForm('p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/buyProduct', bp.toString(), `follow${i}-fallback2060`);
        followed = true;
      }

      if (followed) {
        if (!data.failureType && !data.dialog) {
          const out = { ...data, _state: 'success' };
          if (debug) out._debug = { guid: this.guid, steps };
          return out;
        }
        continue;
      }
      break;
    }

    const out = (!data.failureType)
      ? { ...data, _state: 'success' }
      : { ...data, _state: 'failure', requiresAgeVerification: data.failureType === '2060' };
    if (debug) out._debug = { guid: this.guid, steps };
    return out;
  }

  static async purchaseHistory(Cookie, { debug = false } = {}) {
    const steps = [];
    const add = (obj) => debug && steps.push(obj);

    const url = `https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/purchaseHistory`;
    const hdrs = this.dynHeaders({ 'X-Dsid': Cookie.dsPersonId, 'iCloud-DSID': Cookie.dsPersonId });

    add({ step: 'ph:init', url, method: 'POST', req: { XDsid: hdrs['X-Dsid'], iCloudDSID: hdrs['iCloud-DSID'] } });

    const resp = await this.fetch(url, { method: 'POST', headers: hdrs });
    const text = await resp.text();
    let parsed = {};
    try { parsed = plist.parse(text); } catch { parsed = { parseError: true, text: text?.slice(0, 4000) }; }

    add({ step: 'ph:resp', status: resp.status,
      resp: { keys: Object.keys(parsed || {}), failureType: parsed.failureType } });

    const out = parsed;
    if (debug) out._debug = { guid: this.guid, steps };
    return out;
  }
}

Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store._fetch = fetchCookie(nodeFetch, Store.cookieJar);

// Để tương thích code cũ nếu có chỗ dùng Store.Headers:
Store.Headers = Store.dynHeaders();

export { Store };
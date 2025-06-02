import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

const cookieJar = new fetchCookie.toughCookie.CookieJar();
const fetch = fetchCookie(nodeFetch, cookieJar);

const guid = getMAC().replace(/:/g, '').toUpperCase();

const Headers = {
  'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
  'Content-Type': 'application/x-www-form-urlencoded',
};

async function authenticate(email, password, mfa) {
  const dataJson = {
    appleId: email,
    attempt: mfa ? 2 : 4,
    createSession: 'true',
    guid,
    password: `${password}${mfa ?? ''}`,
    rmp: 0,
    why: 'signIn',
  };

  const body = plist.build(dataJson);
  const url = `https://auth.itunes.apple.com/auth/v1/native/fast?guid=${guid}`;

  const resp = await fetch(url, {
    method: 'POST',
    body,
    headers: Headers,
  });

  const text = await resp.text();
  const parsedResp = plist.parse(text);

  // ✅ Xác định _state
  let _state = 'failure';

  if (
    parsedResp.customerMessage === 'MZFinance.BadLogin.Configurator_message' &&
    !parsedResp.failureType &&
    parsedResp["cancel-purchase-batch"] !== true
  ) {
    _state = 'requires2FA';
  } else if (parsedResp.accountInfo?.address?.firstName) {
    _state = 'success';
  }

  console.log('[DEBUG] Apple parsed:', JSON.stringify(parsedResp, null, 2));
  console.log('[DEBUG] Final _state:', _state);

  return JSON.parse(JSON.stringify({ ...parsedResp, _state }));
}

async function download(appIdentifier, appVerId, Cookie) {
  const dataJson = {
    creditDisplay: '',
    guid,
    salableAdamId: appIdentifier,
    ...(appVerId && { externalVersionId: appVerId }),
  };

  const body = plist.build(dataJson);
  const url = `https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/volumeStoreDownloadProduct?guid=${guid}`;

  const resp = await fetch(url, {
    method: 'POST',
    body,
    headers: {
      ...Headers,
      'X-Dsid': Cookie.dsPersonId,
      'iCloud-DSID': Cookie.dsPersonId,
    },
  });

  const parsedResp = plist.parse(await resp.text());

  return {
    ...parsedResp,
    _state: parsedResp.failureType ? 'failure' : 'success',
  };
}

export const Store = {
  authenticate,
  download,
};
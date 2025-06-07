import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

export const Store = {
  async authenticate(email, password, code) {
    const session = await createSession();
    const result = await login(email, password, code, session);
    return analyzeResponse(result);
  }
};

async function createSession() {
  const resp = await fetch('https://setup.icloud.com/setup/ws/1/accountLogin', {
    method: 'POST',
    headers: {
      'User-Agent': 'iTunes/12.10.1 (Windows; Microsoft Windows 10 x64 Business Edition (Build 19041)) AppleWebKit/7603.3.8.0.3',
      'X-Apple-Store-Front': '143441-1,29',
      'X-Apple-Tz': '0',
      'X-Apple-Locale': 'en_US',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const setCookie = resp.headers.get('set-cookie') || '';
  const sessionId = extractSessionId(setCookie);
  return { sessionId, cookie: setCookie };
}

function extractSessionId(setCookie) {
  const match = /X-Apple-Id-Session-Id=([^;]+);/.exec(setCookie);
  return match ? match[1] : '';
}

async function login(email, password, code, session) {
  const body = new URLSearchParams({
    'appleId': email,
    'accountPassword': password,
  });
  if (code) body.append('verification-code', code);

  const resp = await fetch('https://idmsa.apple.com/IDMSWebAuth/client/authenticate', {
    method: 'POST',
    headers: {
      'User-Agent': 'iTunes/12.10.1 (Windows; Microsoft Windows 10 x64 Business Edition (Build 19041)) AppleWebKit/7603.3.8.0.3',
      'X-Apple-Id-Session-Id': session.sessionId,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '*/*',
      'Cookie': session.cookie,
    },
    body: body.toString()
  });

  const text = await resp.text();
  const statusCode = resp.status;
  const headers = Object.fromEntries(resp.headers.entries());

  console.log('[DEBUG] Apple auth response status:', statusCode);
  console.log('[DEBUG] Headers:', headers);
  console.log('[DEBUG] Raw XML snippet:', text.slice(0, 500));

  let parsed = null;
  try {
    parsed = await parseStringPromise(text, { explicitArray: false });
  } catch (e) {
    console.warn('[DEBUG] Failed to parse XML:', e.message);
  }

  return {
    statusCode,
    headers,
    xml: text,
    parsed,
  };
}

function analyzeResponse({ parsed, xml, headers }) {
  if (!parsed?.plist?.dict) {
    return {
      _state: 'failure',
      customerMessage: '❌ Apple không trả phản hồi hợp lệ',
      failureType: 'invalid_xml',
      raw: xml,
    };
  }

  const dict = parsed.plist.dict;
  const getKeyValue = (key) => {
    const keys = dict.key instanceof Array ? dict.key : [dict.key];
    const values = dict.string instanceof Array ? dict.string : [dict.string];
    const idx = keys.indexOf(key);
    return idx !== -1 ? values[idx] : null;
  };

  const dsid = getKeyValue('dsPersonId');
  const authType = getKeyValue('authType');
  const failureType = getKeyValue('failureType');
  const customerMessage = getKeyValue('customerMessage');

  const hasSessionCookie = headers['set-cookie'] && headers['set-cookie'].includes('X-Apple-Id-Session-Id');

  if (!dsid && (authType?.toLowerCase()?.includes('hsa') ||
                customerMessage?.toLowerCase()?.includes('mfa') ||
                customerMessage?.toLowerCase()?.includes('two-factor') ||
                customerMessage?.toLowerCase()?.includes('code') ||
                customerMessage === 'MZFinance.BadLogin.Configurator_message' ||
                hasSessionCookie)) {
    return {
      _state: '2fa_required',
      require2FA: true,
      customerMessage,
      failureType,
      authType,
      headers,
    };
  }

  if (dsid) {
    return {
      _state: 'success',
      dsPersonId: dsid,
      authType,
      headers,
    };
  }

  return {
    _state: 'failure',
    customerMessage: customerMessage || 'Đăng nhập thất bại',
    failureType,
    authType,
    headers,
  };
}
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

export const Store = {
  async authenticate(email, password, code) {
    const result = await login(email, password, code);
    return analyzeResponse(result);
  }
};

async function login(email, password, code) {
  const body = new URLSearchParams({
    'appleId': email,
    'accountPassword': password,
    'attempt': '4'
  });
  if (code) body.append('verification-code', code);

  const resp = await fetch('https://p12-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate', {
    method: 'POST',
    headers: {
      'User-Agent': 'iTunes/12.10.1 (Windows; Microsoft Windows 10 x64 Business Edition (Build 19041)) AppleWebKit/7603.3.8.0.3',
      'X-Apple-Store-Front': '143441-1,29',
      'X-Apple-Tz': '0',
      'X-Apple-Locale': 'en_US',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '*/*'
    },
    body: body.toString()
  });

  const text = await resp.text();
  const statusCode = resp.status;
  const headers = Object.fromEntries(resp.headers.entries());

  console.log('[DEBUG] Apple MZFinance response status:', statusCode);
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
    parsed
  };
}

function analyzeResponse({ parsed, xml, headers }) {
  if (!parsed?.plist?.dict) {
    return {
      _state: 'failure',
      customerMessage: '❌ Apple không trả phản hồi hợp lệ (không có plist)',
      failureType: 'invalid_xml',
      raw: xml
    };
  }

  const dict = parsed.plist.dict;
  const keys = Array.isArray(dict.key) ? dict.key : [dict.key];
  const values = Array.isArray(dict.string) ? dict.string : [dict.string];

  const getValue = (k) => {
    const i = keys.indexOf(k);
    return i !== -1 ? values[i] : null;
  };

  const dsid = getValue('dsPersonId');
  const authType = getValue('authType');
  const failureType = getValue('failureType');
  const customerMessage = getValue('customerMessage');
  const authOptions = dict['array'] || null;

  if (dsid) {
    return {
      _state: 'success',
      dsPersonId: dsid,
      authOptions,
      customerMessage,
      failureType,
      authType,
      headers
    };
  }

  const twoFAHints = [customerMessage, authType, failureType]
    .map(s => s?.toLowerCase() || '')
    .some(s => s.includes('two') || s.includes('mfa') || s.includes('code'));

  if (twoFAHints || customerMessage === 'MZFinance.BadLogin.Configurator_message') {
    return {
      _state: '2fa_required',
      require2FA: true,
      dsPersonId: dsid,
      authOptions,
      customerMessage,
      failureType,
      authType,
      headers
    };
  }

  return {
    _state: 'failure',
    customerMessage: customerMessage || '❌ Sai Apple ID hoặc mật khẩu',
    failureType,
    authType,
    headers
  };
}

import fetch from 'node-fetch';
import { CookieJar } from 'tough-cookie';
import fetchCookie from 'fetch-cookie';
import plist from 'plist';

const jar = new CookieJar();
const cookieFetch = fetchCookie(fetch, jar);

class Store {
  static async authenticate(email, password, code = null) {
    const baseHeaders = {
      'Origin': 'https://idmsa.apple.com',
      'User-Agent': 'Xcode',
      'Accept': 'application/json',
      'X-Requested-With': 'com.apple.AuthKit',
      'Content-Type': 'application/json'
    };

    const signinBody = JSON.stringify({
      accountName: email,
      password,
      rememberMe: true
    });

    const signinResp = await cookieFetch('https://idmsa.apple.com/appleauth/auth/signin', {
      method: 'POST',
      headers: baseHeaders,
      body: signinBody
    });

    const scnt = signinResp.headers.get('scnt');
    const sessionId = signinResp.headers.get('x-apple-id-session-id');
    const signinStatus = signinResp.status;

    const baseAuthHeaders = {
      ...baseHeaders,
      'scnt': scnt,
      'X-Apple-ID-Session-Id': sessionId
    };

    if (signinStatus === 200) {
      return {
        success: true,
        message: '✅ Đăng nhập thành công (không cần 2FA)',
        sessionId,
        scnt
      };
    }

    if (signinStatus === 401) {
      return {
        success: false,
        message: '❌ Sai Apple ID hoặc mật khẩu',
        status: signinStatus
      };
    }

    if (signinStatus === 409 && !code) {
      return {
        success: false,
        require2FA: true,
        message: '🔐 Cần mã xác minh 2FA',
        sessionId,
        scnt
      };
    }

    if (signinStatus === 409 && code) {
      const verifyResp = await cookieFetch(
        'https://idmsa.apple.com/appleauth/auth/verify/trusteddevice',
        {
          method: 'POST',
          headers: baseAuthHeaders,
          body: JSON.stringify({ securityCode: { code } })
        }
      );

      const verifyStatus = verifyResp.status;
      const json = await verifyResp.json().catch(() => ({}));

      if (verifyStatus === 204) {
        return {
          success: true,
          message: '✅ Xác minh mã 2FA thành công',
          sessionId,
          scnt
        };
      }

      if (verifyStatus === 401) {
        return {
          success: false,
          message: '❌ Sai mã xác minh 2FA',
          status: 401,
          detail: json
        };
      }

      return {
        success: false,
        message: '⚠️ Không xác định được kết quả xác minh mã',
        status: verifyStatus,
        body: json
      };
    }

    return {
      success: false,
      message: '⚠️ Không rõ trạng thái đăng nhập',
      status: signinStatus
    };
  }

  static async download(appIdentifier, appVerId, dsid, passwordToken) {
    const guid = '000000000000';

    const dataJson = {
      creditDisplay: '',
      guid,
      salableAdamId: appIdentifier,
      ...(appVerId && { externalVersionId: appVerId })
    };

    const body = plist.build(dataJson);
    const url = 'https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/volumeStoreDownloadProduct';

    const resp = await cookieFetch(url, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'iTunes/12.10.1 (Macintosh; OS X 10.15.1)',
        'X-Dsid': dsid,
        'iCloud-DSID': dsid,
        'Authorization': `Basic ${Buffer.from(passwordToken + ':').toString('base64')}`
      }
    });

    const text = await resp.text();
    const parsed = plist.parse(text);
    return parsed;
  }
}

export { Store };

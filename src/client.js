import plist from 'plist';
import getMAC from 'getmac';
import fetchCookie from 'fetch-cookie';
import nodeFetch from 'node-fetch';

class Store {
    static get guid() {
        return getMAC().replace(/:/g, '').toUpperCase();
    }

    static async authenticate(email, password, mfa = null) {
        const dataJson = {
            appleId: email,
            attempt: mfa ? 2 : 4,
            createSession: 'true',
            guid: this.guid,
            password: `${password}${mfa ?? ''}`,
            rmp: 0,
            why: 'signIn',
        };

        try {
            const resp = await this.fetch(
                `https://auth.itunes.apple.com/auth/v1/native/fast?guid=${this.guid}`,
                {
                    method: 'POST',
                    body: plist.build(dataJson),
                    headers: this.Headers
                }
            );

            const responseText = await resp.text();
            const parsedResp = plist.parse(responseText);
            console.log('[DEBUG] Apple Auth Response:', JSON.stringify(parsedResp, null, 2));

            // Phát hiện yêu cầu 2FA (HSA2)
            if (parsedResp.authType === 'hsa2' || parsedResp.authType === 'hsa') {
                return {
                    _state: 'requires_2fa',
                    authType: parsedResp.authType,
                    dsPersonId: parsedResp.dsPersonId,
                    customerMessage: parsedResp.customerMessage || 'Vui lòng nhập mã xác minh 2FA',
                    securityCode: {
                        length: parsedResp.securityCode?.length,
                        tooManyAttempts: parsedResp.securityCode?.tooManyAttempts
                    }
                };
            }

            // Xử lý đăng nhập thất bại
            if (parsedResp.failureType || !parsedResp.dsPersonId) {
                return {
                    _state: 'failure',
                    error: this._parseErrorMessage(parsedResp),
                    debug: parsedResp
                };
            }

            // Đăng nhập thành công
            return {
                _state: 'success',
                dsPersonId: parsedResp.dsPersonId,
                passwordToken: parsedResp.passwordToken
            };

        } catch (error) {
            console.error('[ERROR] Authentication failed:', error);
            return {
                _state: 'error',
                error: 'Không thể kết nối đến Apple Server'
            };
        }
    }

    static _parseErrorMessage(response) {
        // Xử lý các thông báo lỗi đặc biệt từ Apple
        if (response.customerMessage) {
            if (response.customerMessage.includes('Configurator_message')) {
                return 'Thiết bị cần xác minh bảo mật. Vui lòng kiểm tra thiết bị tin cậy.';
            }
            return response.customerMessage;
        }
        return 'Sai Apple ID hoặc mật khẩu';
    }

    static async download(appIdentifier, appVerId, Cookie) {
        const dataJson = {
            creditDisplay: '',
            guid: this.guid,
            salableAdamId: appIdentifier,
            ...(appVerId && {externalVersionId: appVerId})
        };

        try {
            const resp = await this.fetch(
                'https://p25-buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/volumeStoreDownloadProduct',
                {
                    method: 'POST',
                    body: plist.build(dataJson),
                    headers: {
                        ...this.Headers,
                        'X-Dsid': Cookie.dsPersonId,
                        'iCloud-DSID': Cookie.dsPersonId
                    }
                }
            );

            const parsedResp = plist.parse(await resp.text());
            return {
                ...parsedResp,
                _state: parsedResp.failureType ? 'failure' : 'success'
            };

        } catch (error) {
            console.error('[ERROR] Download failed:', error);
            return {
                _state: 'failure',
                error: 'Lỗi tải ứng dụng'
            };
        }
    }
}

// Cấu hình fetch với cookie
Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);

// Headers mặc định
Store.Headers = {
    'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
    'Content-Type': 'application/x-www-form-urlencoded',
};

export { Store };
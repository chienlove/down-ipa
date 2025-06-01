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
                    headers: this.Headers,
                    timeout: 10000 // 10 seconds timeout
                }
            );

            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}`);
            }

            const responseText = await resp.text();
            const parsedResp = plist.parse(responseText);
            console.log('[APPLE AUTH RAW]', JSON.stringify(parsedResp, null, 2));

            // Phân tích response theo logic mới
            return this._parseAppleResponse(parsedResp);

        } catch (error) {
            console.error('[NETWORK ERROR]', error);
            return {
                _state: 'network_error',
                error: 'Không thể kết nối đến Apple Server'
            };
        }
    }

    static _parseAppleResponse(response) {
        // 1. Kiểm tra có dsPersonId không (dấu hiệu request hợp lệ)
        const hasValidDSID = !!response.dsPersonId;

        // 2. Kiểm tra yêu cầu 2FA
        const is2FARequest = (
            response.authType === 'hsa2' ||
            response.authType === 'hsa' ||
            response.securityCode ||
            (hasValidDSID && response.customerMessage?.includes('Configurator_message'))
        );

        // 3. Logic chính
        if (is2FARequest && hasValidDSID) {
            return {
                _state: 'requires_2fa',
                dsPersonId: response.dsPersonId,
                authType: response.authType,
                securityCode: response.securityCode,
                customerMessage: this._get2FAMessage(response),
                _isValidRequest: true
            };
        }

        if (!hasValidDSID) {
            return {
                _state: 'invalid_credentials',
                error: this._getErrorMessage(response),
                _shouldRetry: false
            };
        }

        // 4. Trường hợp thành công (hiếm khi xảy ra trực tiếp)
        return {
            _state: 'success',
            dsPersonId: response.dsPersonId,
            passwordToken: response.passwordToken
        };
    }

    static _get2FAMessage(response) {
        if (response.securityCode?.tooManyAttempts) {
            return 'Bạn đã nhập sai mã quá nhiều lần';
        }
        return response.customerMessage || 'Vui lòng nhập mã xác minh 2FA';
    }

    static _getErrorMessage(response) {
        const errorMap = {
            'MZFinance.BadLogin.Configurator_message': 'Vui lòng xác minh trên thiết bị tin cậy',
            'MZFinance.BadLogin.InvalidCredentials': 'Sai Apple ID hoặc mật khẩu',
            'MZFinance.BadLogin.AccountLocked': 'Tài khoản tạm thời bị khóa'
        };

        return errorMap[response.failureType] || 
               response.customerMessage || 
               'Đăng nhập không thành công';
    }

    // ... (giữ nguyên phần download và cấu hình)
}

// Cấu hình fetch
Store.cookieJar = new fetchCookie.toughCookie.CookieJar();
Store.fetch = fetchCookie(nodeFetch, Store.cookieJar);

// Headers
Store.Headers = {
    'User-Agent': 'Configurator/2.15 (Macintosh; OS X 11.0.0; 16G29) AppleWebKit/2603.3.8',
    'Content-Type': 'application/x-www-form-urlencoded',
};

export { Store };
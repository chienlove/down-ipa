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
                    timeout: 15000 // 15 seconds timeout
                }
            );

            if (!resp.ok) {
                throw new Error(`Apple API returned ${resp.status}`);
            }

            const responseText = await resp.text();
            const parsedResp = plist.parse(responseText);
            console.debug('Apple Auth Response:', JSON.stringify(parsedResp, null, 2));

            // Phân tích response theo logic mới
            return this._parseAuthResponse(parsedResp);

        } catch (error) {
            console.error('Authentication Error:', error.stack);
            return {
                _state: 'error',
                error: 'Không thể kết nối đến Apple Server',
                _isNetworkError: true
            };
        }
    }

    static _parseAuthResponse(response) {
        // 1. Kiểm tra có thông tin 2FA không
        const is2FARequired = (
            response.authType === 'hsa2' ||
            response.authType === 'hsa' ||
            response.securityCode ||
            (response.dsPersonId && response.customerMessage?.includes('Configurator_message'))
        );

        // 2. Trường hợp cần 2FA
        if (is2FARequired && response.dsPersonId) {
            return {
                _state: 'requires_2fa',
                dsPersonId: response.dsPersonId,
                authType: response.authType,
                securityCode: response.securityCode,
                customerMessage: this._get2FAMessage(response),
                _isValidResponse: true
            };
        }

        // 3. Trường hợp đăng nhập thất bại
        if (!response.dsPersonId || response.failureType) {
            return {
                _state: 'failure',
                error: this._getErrorMessage(response),
                _shouldRetry: false,
                debug: {
                    rawError: response.customerMessage,
                    failureType: response.failureType
                }
            };
        }

        // 4. Trường hợp thành công
        return {
            _state: 'success',
            dsPersonId: response.dsPersonId,
            passwordToken: response.passwordToken,
            _isAuthenticated: true
        };
    }

    static _get2FAMessage(response) {
        if (response.securityCode?.tooManyAttempts) {
            return 'Bạn đã nhập sai mã quá nhiều lần. Vui lòng thử lại sau.';
        }
        return response.customerMessage || 'Vui lòng nhập mã xác minh từ thiết bị tin cậy';
    }

    static _getErrorMessage(response) {
        const errorMap = {
            'MZFinance.BadLogin.Configurator_message': 'Thiết bị cần xác minh bảo mật',
            'MZFinance.BadLogin.InvalidCredentials': 'Sai Apple ID hoặc mật khẩu',
            'MZFinance.BadLogin.AccountLocked': 'Tài khoản bị khóa tạm thời'
        };

        return errorMap[response.failureType] || 
               response.customerMessage || 
               'Đăng nhập thất bại';
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
                    },
                    timeout: 30000
                }
            );

            const result = plist.parse(await resp.text());
            if (result.failureType) {
                throw new Error(result.customerMessage || 'Download failed');
            }

            return {
                _state: 'success',
                url: result.URL,
                metadata: result.metadata
            };

        } catch (error) {
            console.error('Download Error:', error.message);
            return {
                _state: 'failure',
                error: 'Lỗi tải ứng dụng',
                _shouldRetry: true
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
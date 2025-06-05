document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const elements = {
        step1: document.getElementById('step1'),
        step2: document.getElementById('step2'),
        step3: document.getElementById('step3'),
        loginBtn: document.getElementById('loginBtn'),
        verifyBtn: document.getElementById('verifyBtn'),
        errorBox: document.getElementById('error'),
        errorMessage: document.getElementById('errorMessage'),
        verifyMessage: document.getElementById('verifyMessage'),
        appleIdInput: document.getElementById('APPLE_ID'),
        passwordInput: document.getElementById('PASSWORD'),
        verificationCodeInput: document.getElementById('VERIFICATION_CODE')
    };

    // App State
    const state = {
        APPLE_ID: '',
        PASSWORD: '',
        CODE: '',
        dsid: null,
        requires2FA: false
    };

    // Helper Functions
    const showError = (message) => {
        elements.errorMessage.textContent = message;
        elements.errorBox.style.display = 'block';
    };

    const hideError = () => {
        elements.errorBox.style.display = 'none';
    };

    const showStep = (step) => {
        ['step1', 'step2', 'step3'].forEach(s => {
            elements[s].style.display = s === step ? 'block' : 'none';
        });
    };

    // Event Handlers
    elements.loginBtn.addEventListener('click', async () => {
        hideError();
        state.APPLE_ID = elements.appleIdInput.value.trim();
        state.PASSWORD = elements.passwordInput.value;

        try {
            const response = await fetch('/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    APPLE_ID: state.APPLE_ID, 
                    PASSWORD: state.PASSWORD 
                })
            });

            const data = await response.json();

            if (data.require2FA) {
                state.requires2FA = true;
                state.dsid = data.dsid;
                elements.verifyMessage.textContent = data.message;
                showStep('step2');
                return;
            }

            if (data.success) {
                state.dsid = data.dsid;
                showStep('step3');
                return;
            }

            showError(data.error || 'Đăng nhập thất bại');

        } catch (error) {
            showError('Lỗi kết nối đến máy chủ');
        }
    });

    elements.verifyBtn.addEventListener('click', async () => {
        hideError();
        state.CODE = elements.verificationCodeInput.value.trim();

        try {
            const response = await fetch('/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    APPLE_ID: state.APPLE_ID,
                    PASSWORD: state.PASSWORD,
                    CODE: state.CODE,
                    dsid: state.dsid
                })
            });

            const data = await response.json();

            if (data.success) {
                showStep('step3');
                return;
            }

            showError(data.error || 'Mã xác minh không đúng');
            elements.verificationCodeInput.value = '';
            elements.verificationCodeInput.focus();

        } catch (error) {
            showError('Lỗi xác minh 2FA');
        }
    });
});
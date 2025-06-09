document.addEventListener('DOMContentLoaded', () => {
  const elements = {
    step1: document.getElementById('step1'),
    step2: document.getElementById('step2'),
    step3: document.getElementById('step3'),
    result: document.getElementById('result'),
    loginBtn: document.getElementById('loginBtn'),
    verifyBtn: document.getElementById('verifyBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    errorBox: document.getElementById('error'),
    errorMessage: document.getElementById('errorMessage'),
    verifyMessage: document.getElementById('verifyMessage'),
    progressBar: document.getElementById('progressBar'),
    togglePassword: document.getElementById('togglePassword'),
    passwordInput: document.getElementById('PASSWORD'),
    eyeIcon: document.getElementById('eyeIcon'),
    appleIdInput: document.getElementById('APPLE_ID'),
    verificationCodeInput: document.getElementById('VERIFICATION_CODE'),
    appIdInput: document.getElementById('APPID'),
    appVerInput: document.getElementById('APP_VER_ID'),
    installLink: document.getElementById('installLink'),
    resetBtn: document.getElementById('resetBtn')
  };

  const state = {
    APPLE_ID: '',
    PASSWORD: '',
    CODE: '',
    verified2FA: false,
    dsid: null,
    requires2FA: false
  };

  const setProgress = (step) => {
    const map = { 1: '25%', 2: '60%', 3: '90%', 4: '100%' };
    elements.progressBar.style.width = map[step] || '0%';
  };

  const showError = (msg) => {
    elements.errorMessage.textContent = msg;
    elements.errorBox.classList.remove('hidden');
  };

  const hideError = () => {
    elements.errorBox.classList.add('hidden');
  };

  const transition = (from, to) => {
    from.classList.add('hidden');
    to.classList.remove('hidden');
  };

  elements.loginBtn.addEventListener('click', async () => {
    hideError();
    const APPLE_ID = elements.appleIdInput.value.trim();
    const PASSWORD = elements.passwordInput.value;

    if (!APPLE_ID || !PASSWORD) {
      showError('Vui lòng nhập Apple ID và mật khẩu.');
      return;
    }

    state.APPLE_ID = APPLE_ID;
    state.PASSWORD = PASSWORD;

    const res = await fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ APPLE_ID, PASSWORD })
    });
    const data = await res.json();

    if (data.require2FA) {
      state.requires2FA = true;
      elements.verifyMessage.textContent = data.message || 'Vui lòng nhập mã xác minh';
      transition(elements.step1, elements.step2);
      setProgress(2);
    } else if (data.success) {
      state.verified2FA = true;
      transition(elements.step1, elements.step3);
      setProgress(3);
    } else {
      showError(data.error || 'Lỗi đăng nhập');
    }
  });

  elements.verifyBtn.addEventListener('click', async () => {
    hideError();
    const CODE = elements.verificationCodeInput.value.trim();
    if (CODE.length !== 6) {
      showError('Mã xác minh phải có 6 chữ số.');
      return;
    }

    state.CODE = CODE;

    const res = await fetch('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        APPLE_ID: state.APPLE_ID, 
        PASSWORD: state.PASSWORD, 
        CODE 
      })
    });

    const data = await res.json();
    if (data.success) {
      state.verified2FA = true;
      transition(elements.step2, elements.step3);
      setProgress(3);
    } else {
      showError(data.error || 'Mã xác minh không đúng');
    }
  });

  elements.downloadBtn.addEventListener('click', async () => {
    hideError();
    const APPID = elements.appIdInput.value.trim().match(/id(\d+)|^\d+$/)?.[1] || '';
    const appVerId = elements.appVerInput.value.trim();

    if (!APPID) {
      showError('Vui lòng nhập App ID hợp lệ.');
      return;
    }

    if (state.requires2FA && !state.verified2FA) {
      showError('Vui lòng hoàn thành xác thực 2FA trước khi tải.');
      return;
    }

    const res = await fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        APPLE_ID: state.APPLE_ID,
        PASSWORD: state.PASSWORD,
        CODE: state.CODE,
        APPID,
        appVerId
      })
    });

    const data = await res.json();

    if (data.success) {
      document.getElementById('appName').textContent = data.appInfo.name;
      document.getElementById('appAuthor').textContent = data.appInfo.artist;
      document.getElementById('appVersion').textContent = data.appInfo.version;
      document.getElementById('appBundleId').textContent = data.appInfo.bundleId;
      document.getElementById('appDate').textContent = data.appInfo.releaseDate;

      elements.installLink.href = data.installUrl;
      elements.installLink.classList.remove('hidden');

      transition(elements.step3, elements.result);
      setProgress(4);
    } else {
      showError(data.error || 'Tải ứng dụng thất bại.');
    }
  });

  // Tải ứng dụng khác
  elements.resetBtn.addEventListener('click', () => {
    location.reload();
  });
});
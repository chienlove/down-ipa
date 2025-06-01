document.addEventListener('DOMContentLoaded', () => {
  const el = {
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
    eyeIcon: document.getElementById('eyeIcon')
  };

  const state = {
    APPLE_ID: '',
    PASSWORD: '',
    CODE: '',
    verified2FA: false
  };

  const showError = (msg) => {
    el.errorMessage.textContent = msg;
    el.errorBox.classList.remove('hidden');
  };

  const hideError = () => el.errorBox.classList.add('hidden');

  const transition = (from, to) => {
    from.classList.add('animate__fadeOut');
    setTimeout(() => {
      from.classList.add('hidden');
      from.classList.remove('animate__fadeOut');
      to.classList.remove('hidden');
      to.classList.add('animate__fadeIn');
      setTimeout(() => to.classList.remove('animate__fadeIn'), 500);
    }, 300);
  };

  const setProgress = (step) => {
    const map = { 1: '25%', 2: '60%', 3: '90%', 4: '100%' };
    el.progressBar.style.width = map[step] || '0%';
  };

  // Toggle password visibility with icon switch
  el.togglePassword.addEventListener('click', () => {
    const isPassword = el.passwordInput.type === 'password';
    el.passwordInput.type = isPassword ? 'text' : 'password';
    el.eyeIcon.innerHTML = isPassword
      ? `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.966 9.966 0 012.842-4.275m3.763-2.174A9.977 9.977 0 0112 5
          c4.478 0 8.268 2.943 9.542 7a9.972 9.972 0 01-1.731 2.885M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>`
      : `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
         <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M2.458 12C3.732 7.943 7.523 5 12 5
          c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7
          -4.477 0-8.268-2.943-9.542-7z"/>`;
  });

  // Step 1: Login
  el.loginBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    hideError();

    const APPLE_ID = document.getElementById('APPLE_ID').value.trim();
    const PASSWORD = document.getElementById('PASSWORD').value;
    if (!APPLE_ID || !PASSWORD) return showError('Vui lòng nhập Apple ID và mật khẩu.');

    state.APPLE_ID = APPLE_ID;
    state.PASSWORD = PASSWORD;

    setProgress(1);

    const res = await fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ APPLE_ID, PASSWORD })
    });

    const data = await res.json();
    if (data.require2FA) {
      state.verified2FA = false;
      el.verifyMessage.textContent = data.message || 'Vui lòng nhập mã xác minh';
      transition(el.step1, el.step2);
      setProgress(2);
    } else if (data.success) {
      transition(el.step1, el.step3);
      setProgress(3);
    } else {
      showError(data.error || 'Đăng nhập thất bại');
    }
  });

  // Step 2: Verify
  el.verifyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    hideError();
    const CODE = document.getElementById('VERIFICATION_CODE').value.trim();
    if (CODE.length !== 6) return showError('Mã xác minh phải có 6 chữ số.');

    setProgress(2);
    const res = await fetch('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state, CODE })
    });

    const data = await res.json();
    if (data.success) {
      state.CODE = CODE;
      state.verified2FA = true;
      transition(el.step2, el.step3);
      setProgress(3);
    } else {
      showError(data.error || 'Mã xác minh không đúng.');
    }
  });

  // Step 3: Download
  el.downloadBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    hideError();

    const APPID = document.getElementById('APPID').value.trim().match(/id(\d+)|^\d+$/)?.[1] || '';
    const appVerId = document.getElementById('APP_VER_ID').value.trim();

    if (!APPID) return showError('Vui lòng nhập App ID hợp lệ.');
    if (!state.verified2FA && !state.CODE) return showError('Vui lòng xác thực 2FA trước.');

    setProgress(3);

    const res = await fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state, APPID, appVerId })
    });

    const data = await res.json();
    if (data.require2FA) {
      state.verified2FA = false;
      el.verifyMessage.textContent = data.message || 'Cần xác minh lại mã 2FA';
      transition(el.step3, el.step2);
      setProgress(2);
    } else if (data.success) {
      document.getElementById('appName').textContent = data.appInfo.name;
      document.getElementById('appAuthor').textContent = data.appInfo.artist;
      document.getElementById('appVersion').textContent = data.appInfo.version;
      document.getElementById('appBundleId').textContent = data.appInfo.bundleId;
      document.getElementById('appDate').textContent = data.appInfo.releaseDate;
      const downloadLink = document.getElementById('downloadLink');
      downloadLink.href = data.downloadUrl;
      downloadLink.download = data.fileName;
      transition(el.step3, el.result);
      setProgress(4);
    } else {
      showError(data.error || 'Tải ứng dụng thất bại.');
    }
  });
});
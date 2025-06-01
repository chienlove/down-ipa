document.addEventListener('DOMContentLoaded', () => {
  const state = {
    APPLE_ID: '',
    PASSWORD: '',
    CODE: '',
    APPID: '',
    appVerId: '',
    verified2FA: false,
  };

  const el = {
    step1: document.getElementById('step1'),
    step2: document.getElementById('step2'),
    step3: document.getElementById('step3'),
    result: document.getElementById('result'),
    errorBox: document.getElementById('error'),
    errorMessage: document.getElementById('errorMessage'),
    verifyMessage: document.getElementById('verifyMessage'),
    progressBar: document.getElementById('progressBar'),
    loginBtn: document.getElementById('loginBtn'),
    verifyBtn: document.getElementById('verifyBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    togglePassword: document.getElementById('togglePassword'),
    passwordInput: document.getElementById('PASSWORD'),
    eyeIcon: document.getElementById('eyeIcon'),
  };

  const setButtonLoading = (btn, loading) => {
    if (loading) {
      btn.disabled = true;
      btn.innerHTML = `
        <svg class="animate-spin mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg> Đang xử lý...
      `;
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText;
    }
  };

  const setProgress = (step) => {
    const map = { 1: '25%', 2: '60%', 3: '90%', 4: '100%' };
    el.progressBar.style.width = map[step] || '0%';
  };

  const showError = (msg) => {
    el.errorMessage.textContent = msg;
    el.errorBox.classList.remove('hidden');
  };

  const hideError = () => {
    el.errorBox.classList.add('hidden');
  };

  const transition = (fromEl, toEl) => {
    fromEl.classList.add('animate__animated', 'animate__fadeOut');
    setTimeout(() => {
      fromEl.classList.add('hidden');
      fromEl.classList.remove('animate__fadeOut');
      toEl.classList.remove('hidden');
      toEl.classList.add('animate__animated', 'animate__fadeIn');
      setTimeout(() => toEl.classList.remove('animate__fadeIn'), 500);
    }, 300);
  };

  const extractAppId = (input) => {
    if (/^\d+$/.test(input)) return input;
    const match = input.match(/id(\d+)/);
    return match ? match[1] : '';
  };

  const displayResult = ({ appInfo, downloadUrl, fileName }) => {
    document.getElementById('appName').textContent = appInfo.name || 'Không rõ';
    document.getElementById('appAuthor').textContent = appInfo.artist || 'Không rõ';
    document.getElementById('appVersion').textContent = appInfo.version || 'Không rõ';
    document.getElementById('appBundleId').textContent = appInfo.bundleId || 'Không rõ';
    document.getElementById('appDate').textContent = appInfo.releaseDate || 'Không rõ';

    const downloadLink = document.getElementById('downloadLink');
    downloadLink.href = downloadUrl;
    downloadLink.download = fileName || 'app.ipa';
  };

  // Toggle password visibility
  el.togglePassword.addEventListener('click', () => {
    const isHidden = el.passwordInput.type === 'password';
    el.passwordInput.type = isHidden ? 'text' : 'password';
    el.eyeIcon.innerHTML = isHidden
      ? `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.956 9.956 0 013.293-4.528M15 12a3 3 0 01-6 0"/>`
      : `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
  });

  // STEP 1: LOGIN
  el.loginBtn.dataset.originalText = el.loginBtn.textContent;
  el.loginBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    hideError();

    const appleId = document.getElementById('APPLE_ID').value.trim();
    const password = document.getElementById('PASSWORD').value;

    if (!appleId || !password) {
      return showError('Vui lòng nhập đầy đủ Apple ID và mật khẩu.');
    }

    state.APPLE_ID = appleId;
    state.PASSWORD = password;

    setButtonLoading(el.loginBtn, true);
    setProgress(1);

    try {
      const res = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ APPLE_ID: appleId, PASSWORD: password }),
      });

      const data = await res.json();

      if (data.require2FA) {
        state.verified2FA = false;
        el.verifyMessage.textContent = data.message || 'Nhập mã xác minh được gửi đến thiết bị của bạn';
        transition(el.step1, el.step2);
        setProgress(2);
      } else if (data.success) {
        state.verified2FA = true;
        transition(el.step1, el.step3);
        setProgress(3);
      } else {
        showError(data.error || 'Đăng nhập thất bại.');
      }
    } catch (err) {
      console.error(err);
      showError('Lỗi kết nối máy chủ.');
    } finally {
      setButtonLoading(el.loginBtn, false);
    }
  });

  // STEP 2: VERIFY
  el.verifyBtn.dataset.originalText = el.verifyBtn.textContent;
  el.verifyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    hideError();

    const code = document.getElementById('VERIFICATION_CODE').value.trim();
    if (!/^\d{6}$/.test(code)) return showError('Vui lòng nhập mã xác minh 6 chữ số.');

    setButtonLoading(el.verifyBtn, true);
    setProgress(2);

    try {
      const res = await fetch('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          APPLE_ID: state.APPLE_ID,
          PASSWORD: state.PASSWORD,
          CODE: code,
        }),
      });

      const data = await res.json();

      if (data.success) {
        state.CODE = code;
        state.verified2FA = true;
        transition(el.step2, el.step3);
        setProgress(3);
      } else {
        showError(data.error || 'Xác minh thất bại.');
      }
    } catch (err) {
      console.error(err);
      showError('Lỗi xác minh.');
    } finally {
      setButtonLoading(el.verifyBtn, false);
    }
  });

  // STEP 3: DOWNLOAD
  el.downloadBtn.dataset.originalText = el.downloadBtn.textContent;
  el.downloadBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    hideError();

    const raw = document.getElementById('APPID').value.trim();
    state.APPID = extractAppId(raw);
    state.appVerId = document.getElementById('APP_VER_ID').value.trim();

    if (!state.APPID) return showError('Vui lòng nhập App ID hợp lệ.');
    if (!state.verified2FA) return showError('Bạn cần xác thực 2FA trước khi tải.');

    setButtonLoading(el.downloadBtn, true);
    setProgress(3);

    try {
      const res = await fetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });

      const data = await res.json();

      if (data.require2FA) {
        state.verified2FA = false;
        el.verifyMessage.textContent = data.message || 'Cần xác thực lại mã 2FA';
        transition(el.step3, el.step2);
        setProgress(2);
      } else if (data.success) {
        displayResult(data);
        transition(el.step3, el.result);
        setProgress(4);
      } else {
        showError(data.error || 'Tải xuống thất bại.');
      }
    } catch (err) {
      console.error(err);
      showError('Lỗi khi tải xuống.');
    } finally {
      setButtonLoading(el.downloadBtn, false);
    }
  });
});
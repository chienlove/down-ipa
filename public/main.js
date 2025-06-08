document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const elements = {
    step1: document.getElementById('step1'),
    step2: document.getElementById('step2'),
    step3: document.getElementById('step3'),
    result: document.getElementById('result'),
    loginBtn: document.getElementById('loginBtn'),
    verifyBtn: document.getElementById('verifyBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    resetBtn: document.getElementById('resetBtn'),
    installBtn: document.getElementById('installBtn'),
    downloadIPA: document.getElementById('downloadIPA'),
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
    appName: document.getElementById('appName'),
    appAuthor: document.getElementById('appAuthor'),
    appVersion: document.getElementById('appVersion'),
    appBundleId: document.getElementById('appBundleId'),
    appDate: document.getElementById('appDate')
  };

  // App State
  const state = {
    APPLE_ID: '',
    PASSWORD: '',
    CODE: '',
    verified2FA: false,
    dsid: null,
    requires2FA: false,
    currentDownloadData: null
  };

  let isLoading = false;

  /* ========== UI HELPERS ========== */
  const showToast = (message, type = 'success') => {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'success' ? '✓' : '✗'}</span>
      <span>${message}</span>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
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

  const setProgress = (step) => {
    const widths = { 1: '25%', 2: '60%', 3: '90%', 4: '100%' };
    elements.progressBar.style.width = widths[step] || '0%';
  };

  const setLoading = (loading) => {
    isLoading = loading;
    document.querySelectorAll('button').forEach(btn => {
      btn.disabled = loading;
    });
  };

  const handle2FARedirect = (responseData) => {
    state.requires2FA = true;
    state.dsid = responseData.dsid;
    elements.verifyMessage.textContent = responseData.message || 'Vui lòng nhập mã xác minh 6 chữ số';
    elements.step2.style.display = 'block';
    transition(elements.step1, elements.step2);
    setProgress(2);
  };

  /* ========== EVENT HANDLERS ========== */
  elements.loginBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isLoading) return;
    
    hideError();
    setLoading(true);

    const APPLE_ID = elements.appleIdInput.value.trim();
    const PASSWORD = elements.passwordInput.value;
    
    if (!APPLE_ID || !PASSWORD) {
      showError('Vui lòng nhập Apple ID và mật khẩu.');
      setLoading(false);
      return;
    }

    state.APPLE_ID = APPLE_ID;
    state.PASSWORD = PASSWORD;

    setProgress(1);

    try {
      const response = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ APPLE_ID, PASSWORD })
      });

      const data = await response.json();

      if (data.require2FA) {
        handle2FARedirect(data);
        return;
      }

      if (data.success) {
        state.requires2FA = false;
        state.verified2FA = true;
        state.dsid = data.dsid;
        showToast('Đăng nhập thành công!');
        transition(elements.step1, elements.step3);
        setProgress(3);
      } else {
        showError(data.error || 'Đăng nhập thất bại');
      }
    } catch (error) {
      showError('Không thể kết nối tới máy chủ.');
    } finally {
      setLoading(false);
    }
  });

  elements.verifyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isLoading) return;
    
    hideError();
    setLoading(true);

    const CODE = elements.verificationCodeInput.value.trim();
    if (CODE.length !== 6) {
      showError('Mã xác minh phải có 6 chữ số.');
      setLoading(false);
      return;
    }

    setProgress(2);

    try {
      const response = await fetch('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          APPLE_ID: state.APPLE_ID, 
          PASSWORD: state.PASSWORD, 
          CODE,
          dsid: state.dsid 
        })
      });

      const data = await response.json();

      if (data.success) {
        state.CODE = CODE;
        state.verified2FA = true;
        showToast('Xác thực 2FA thành công!');
        elements.step2.classList.add('hidden');
        transition(elements.step2, elements.step3);
        setProgress(3);
      } else {
        showError(data.error || 'Mã xác minh không đúng.');
      }
    } catch (error) {
      showError('Không thể kết nối tới máy chủ.');
    } finally {
      setLoading(false);
    }
  });

  elements.downloadBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isLoading) return;
    
    hideError();
    setLoading(true);

    const APPID = elements.appIdInput.value.trim().match(/id(\d+)|^\d+$/)?.[1] || '';
    const appVerId = elements.appVerInput.value.trim();

    if (!APPID) {
      showError('Vui lòng nhập App ID hợp lệ.');
      setLoading(false);
      return;
    }

    if (state.requires2FA && !state.verified2FA) {
      showError('Vui lòng hoàn thành xác thực 2FA trước khi tải.');
      setLoading(false);
      elements.step2.style.display = 'block';
      transition(elements.step3, elements.step2);
      return;
    }

    setProgress(3);

    try {
      const response = await fetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          APPLE_ID: state.APPLE_ID,
          PASSWORD: state.PASSWORD,
          CODE: state.CODE,
          APPID,
          appVerId,
          dsid: state.dsid
        })
      });

      const data = await response.json();

      if (data.require2FA) {
        handle2FARedirect(data);
      } else if (data.success) {
        state.currentDownloadData = data;
        showResult(data);
      } else {
        showError(data.error || 'Tải ứng dụng thất bại.');
      }
    } catch (error) {
      showError('Không thể kết nối tới máy chủ.');
    } finally {
      setLoading(false);
    }
  });

  function showResult(data) {
    elements.appName.textContent = data.appInfo.name;
    elements.appAuthor.textContent = data.appInfo.artist;
    elements.appVersion.textContent = data.appInfo.version;
    elements.appBundleId.textContent = data.appInfo.bundleId;
    elements.appDate.textContent = data.appInfo.releaseDate;
    
    elements.downloadIPA.href = data.downloadUrl;
    elements.downloadIPA.download = data.fileName;
    
    elements.installBtn.onclick = () => {
      window.location.href = data.installUrl;
    };
    
    transition(elements.step3, elements.result);
    setProgress(4);
  }

  elements.resetBtn.addEventListener('click', () => {
    fetch('/reset', { method: 'POST' })
      .then(() => {
        state.APPLE_ID = '';
        state.PASSWORD = '';
        state.CODE = '';
        state.verified2FA = false;
        state.requires2FA = false;
        
        elements.appleIdInput.value = '';
        elements.passwordInput.value = '';
        elements.verificationCodeInput.value = '';
        elements.appIdInput.value = '';
        elements.appVerInput.value = '';
        
        transition(elements.result, elements.step1);
        setProgress(0);
        showToast('Đã reset form thành công!');
      });
  });

  // Toggle password visibility
  elements.togglePassword.addEventListener('click', () => {
    const isPassword = elements.passwordInput.type === 'password';
    elements.passwordInput.type = isPassword ? 'text' : 'password';
    elements.eyeIcon.innerHTML = isPassword
      ? `<path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.966 9.966 0 012.842-4.275m3.763-2.174A9.977 9.977 0 0112 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`
      : `<path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
  });
});
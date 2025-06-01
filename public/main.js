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
    eyeIcon: document.getElementById('eyeIcon'),
    appleIdInput: document.getElementById('APPLE_ID'),
    verificationCodeInput: document.getElementById('VERIFICATION_CODE')
  };

  const state = {
    APPLE_ID: '',
    PASSWORD: '',
    CODE: '',
    verified2FA: false,
    dsid: null,
    authType: null // '2fa' hoặc 'password'
  };

  let isLoading = false;

  // Tạo toast container
  const toastContainer = document.createElement('div');
  toastContainer.className = 'fixed top-4 right-4 z-50 space-y-2 w-80';
  document.body.appendChild(toastContainer);

  // Thêm CSS
  const style = document.createElement('style');
  style.textContent = `
    .progress-loading {
      width: 100% !important;
      animation: progress 2s linear infinite !important;
    }
    .button-loading {
      position: relative;
      color: transparent !important;
    }
    .button-loading::after {
      content: '';
      position: absolute;
      width: 20px;
      height: 20px;
      top: 50%;
      left: 50%;
      margin: -10px 0 0 -10px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
    }
    .toast {
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      color: white;
      display: flex;
      align-items: center;
      animation: slideIn 0.3s ease-out, fadeOut 0.5s ease-in 2.5s forwards;
      transform: translateX(100%);
      opacity: 0;
    }
    .toast-success {
      background-color: #10B981;
    }
    .toast-error {
      background-color: #EF4444;
    }
    .toast-icon {
      margin-right: 12px;
      font-size: 20px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes slideIn {
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes fadeOut {
      to { opacity: 0; }
    }
    #step2 {
      display: none;
    }
  `;
  document.head.appendChild(style);

  // Hiển thị toast thông báo
  const showToast = (message, type = 'success') => {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'success' ? '✓' : '✗'}</span>
      <span>${message}</span>
    `;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.style.transform = 'translateX(0)';
      toast.style.opacity = '1';
    }, 10);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  };

  const showError = (msg) => {
    el.errorMessage.textContent = msg;
    el.errorBox.classList.remove('hidden');
    setTimeout(() => {
      el.errorBox.classList.add('animate__fadeIn');
    }, 10);
  };

  const hideError = () => {
    el.errorBox.classList.add('hidden');
    el.errorBox.classList.remove('animate__fadeIn');
  };

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

  const setLoading = (loading) => {
    isLoading = loading;
    if (loading) {
      el.progressBar.classList.add('progress-loading');
      document.querySelectorAll('button').forEach(btn => {
        btn.classList.add('button-loading');
        btn.disabled = true;
      });
    } else {
      el.progressBar.classList.remove('progress-loading');
      document.querySelectorAll('button').forEach(btn => {
        btn.classList.remove('button-loading');
        btn.disabled = false;
      });
    }
  };

  // Toggle password visibility
  el.togglePassword.addEventListener('click', () => {
    const isPassword = el.passwordInput.type === 'password';
    el.passwordInput.type = isPassword ? 'text' : 'password';
    el.eyeIcon.innerHTML = isPassword
      ? `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.966 9.966 0 012.842-4.275m3.763-2.174A9.977 9.977 0 0112 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`
      : `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
  });

  // Step 1: Login
  el.loginBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isLoading) return;
    
    hideError();
    setLoading(true);

    const APPLE_ID = el.appleIdInput.value.trim();
    const PASSWORD = el.passwordInput.value;
    
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
      console.log('Auth response:', data); // Debug log

      if (!response.ok) {
        showError(data.error || 'Lỗi từ máy chủ.');
        return;
      }

      // Xử lý trường hợp cần 2FA
      if (data.require2FA || data.authType === '2fa') {
        state.authType = '2fa';
        state.verified2FA = false;
        state.dsid = data.dsid || null;
        el.verifyMessage.textContent = data.message || 'Vui lòng nhập mã xác minh 6 chữ số được gửi đến thiết bị của bạn';
        
        // Hiển thị step2
        el.step2.style.display = 'block';
        el.step2.classList.remove('hidden');
        
        transition(el.step1, el.step2);
        setProgress(2);
      } 
      // Xử lý đăng nhập thành công không cần 2FA
      else if (data.success) {
        state.authType = 'password';
        state.verified2FA = true;
        state.dsid = data.dsid || null;
        showToast('Đăng nhập thành công!');
        transition(el.step1, el.step3);
        setProgress(3);
      } else {
        showError(data.error || 'Đăng nhập thất bại');
      }
    } catch (error) {
      console.error('Auth error:', error);
      showError('Không thể kết nối tới máy chủ.');
    } finally {
      setLoading(false);
    }
  });

  // Step 2: Verify 2FA
  el.verifyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isLoading) return;
    
    hideError();
    setLoading(true);

    const CODE = el.verificationCodeInput.value.trim();
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
      console.log('Verify response:', data); // Debug log

      if (!response.ok) {
        showError(data.error || 'Xác minh thất bại.');
        return;
      }

      if (data.success) {
        state.CODE = CODE;
        state.verified2FA = true;
        state.dsid = data.dsid || state.dsid;
        showToast('Xác thực 2FA thành công!');
        transition(el.step2, el.step3);
        setProgress(3);
      } else {
        showError(data.error || 'Mã xác minh không đúng.');
      }
    } catch (error) {
      console.error('Verify error:', error);
      showError('Không thể kết nối tới máy chủ.');
    } finally {
      setLoading(false);
    }
  });

  // Step 3: Download
  el.downloadBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isLoading) return;
    
    hideError();
    setLoading(true);

    const APPID = document.getElementById('APPID').value.trim().match(/id(\d+)|^\d+$/)?.[1] || '';
    const appVerId = document.getElementById('APP_VER_ID').value.trim();

    if (!APPID) {
      showError('Vui lòng nhập App ID hợp lệ.');
      setLoading(false);
      return;
    }

    // Kiểm tra xác thực 2FA
    if (!state.verified2FA) {
      showError('Vui lòng xác thực 2FA trước khi tải ứng dụng.');
      setLoading(false);
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
      console.log('Download response:', data); // Debug log

      if (!response.ok) {
        showError(data.error || 'Tải thất bại.');
        return;
      }

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
    } catch (error) {
      console.error('Download error:', error);
      showError('Không thể kết nối tới máy chủ.');
    } finally {
      setLoading(false);
    }
  });
});
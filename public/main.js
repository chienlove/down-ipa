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
    appVerInput: document.getElementById('APP_VER_ID')
  };

  // App State
  const state = {
    APPLE_ID: '',
    PASSWORD: '',
    CODE: '',
    verified2FA: false,
    dsid: null,
    requires2FA: false
  };

  let isLoading = false;

  /* ========== UI HELPERS ========== */
  
  // Create toast container
  const toastContainer = document.createElement('div');
  toastContainer.id = 'toast-container';
  toastContainer.className = 'fixed top-4 right-4 z-50 space-y-2 w-80';
  document.body.appendChild(toastContainer);

  // Add CSS styles
  const addStyles = () => {
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
  };
  addStyles();

  /* ========== CORE FUNCTIONS ========== */

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

    setTimeout(() => toast.remove(), 3000);
  };

  const showError = (msg) => {
    elements.errorMessage.textContent = msg;
    elements.errorBox.classList.remove('hidden');
    setTimeout(() => {
      elements.errorBox.classList.add('animate__fadeIn');
    }, 10);
  };

  const hideError = () => {
    elements.errorBox.classList.add('hidden');
    elements.errorBox.classList.remove('animate__fadeIn');
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
    elements.progressBar.style.width = map[step] || '0%';
  };

  const setLoading = (loading) => {
    isLoading = loading;
    if (loading) {
      elements.progressBar.classList.add('progress-loading');
      document.querySelectorAll('button').forEach(btn => {
        btn.classList.add('button-loading');
        btn.disabled = true;
      });
    } else {
      elements.progressBar.classList.remove('progress-loading');
      document.querySelectorAll('button').forEach(btn => {
        btn.classList.remove('button-loading');
        btn.disabled = false;
      });
    }
  };

  const handle2FARedirect = (responseData) => {
    state.requires2FA = true;
    state.verified2FA = false;
    state.dsid = responseData.dsid || null;
    // Friendly error mapping
let message = responseData.message || '';
if (message.includes('MZFinance.BadLogin.Configurator_message')) {
  message = 'Thiết bị cần xác minh bảo mật. Vui lòng kiểm tra thiết bị tin cậy của bạn.';
} else if (message.toLowerCase().includes('code')) {
  message = 'Vui lòng nhập mã xác minh 6 chữ số được gửi đến thiết bị tin cậy.';
}

elements.verifyMessage.textContent = message || 'Vui lòng nhập mã xác minh 6 chữ số';
    
    // Force show step2
    elements.step2.style.display = 'block';
    elements.step2.classList.remove('hidden');
    
    transition(elements.step1, elements.step2);
    setProgress(2);
  };

  /* ========== EVENT HANDLERS ========== */

  // Toggle password visibility
  elements.togglePassword.addEventListener('click', () => {
    const isPassword = elements.passwordInput.type === 'password';
    elements.passwordInput.type = isPassword ? 'text' : 'password';
    elements.eyeIcon.innerHTML = isPassword
      ? `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.966 9.966 0 012.842-4.275m3.763-2.174A9.977 9.977 0 0112 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`
      : `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
  });

  // Step 1: Login
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
    console.log('Auth response:', data);

    if (!response.ok) {
      showError(data.error || 'Lỗi từ máy chủ.');
      setLoading(false);
      return;
    }

    // Chỉ xử lý 2FA khi response có require2FA = true VÀ _state không phải 'failure'
    if ((data.require2FA || data.authType === '2fa') && data._state !== 'failure') {
      handle2FARedirect(data);
      return;
    }

    // Nếu _state là 'failure' thì hiển thị lỗi
    if (data._state === 'failure') {
      showError(data.message || data.customerMessage || 'Đăng nhập thất bại');
      setLoading(false);
      return;
    }

    // Xử lý đăng nhập thành công không cần 2FA
    if (data.success) {
      state.requires2FA = false;
      state.verified2FA = true;
      state.dsid = data.dsid || null;
      showToast('Đăng nhập thành công!');
      transition(elements.step1, elements.step3);
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
      console.log('Verify response:', data);

      if (!response.ok) {
        showError(data.error || 'Xác minh thất bại.');
        return;
      }

      if (data.success) {
  state.CODE = CODE;
  state.verified2FA = true;
  state.dsid = data.dsid || state.dsid;
  showToast('Xác thực 2FA thành công!');

  // Ẩn step2 hoàn toàn
  elements.step2.classList.add('hidden');
  elements.step2.style.display = 'none';
  elements.verificationCodeInput.value = '';
  elements.verifyMessage.textContent = '';

  transition(elements.step2, elements.step3);
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

  // Step 3: Download - With strict 2FA check
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

    // Strict 2FA verification check
    if (state.requires2FA && !state.verified2FA) {
      showError('Vui lòng hoàn thành xác thực 2FA trước khi tải.');
      setLoading(false);
      
      // Auto-redirect to 2FA step
      elements.step2.style.display = 'block';
      elements.step2.classList.remove('hidden');
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
      console.log('Download response:', data);

      if (data.require2FA) {
        handle2FARedirect(data);
      } else if (data.success) {
        // Display download result
        document.getElementById('appName').textContent = data.appInfo.name;
        document.getElementById('appAuthor').textContent = data.appInfo.artist;
        document.getElementById('appVersion').textContent = data.appInfo.version;
        document.getElementById('appBundleId').textContent = data.appInfo.bundleId;
        document.getElementById('appDate').textContent = data.appInfo.releaseDate;
        const downloadLink = document.getElementById('downloadLink');
        downloadLink.href = data.downloadUrl;
        downloadLink.download = data.fileName;

const downloadLink = document.getElementById('downloadLink');
downloadLink.href = data.downloadUrl;
downloadLink.download = data.fileName;

let installBtn = document.getElementById('installBtn');
if (!installBtn) {
  installBtn = document.createElement('a');
  installBtn.id = 'installBtn';
  installBtn.className = downloadLink.className + ' bg-indigo-600 hover:from-indigo-700 hover:to-indigo-600 mt-2';
  installBtn.textContent = '📲 Cài trực tiếp';
  installBtn.target = '_blank';
  downloadLink.parentNode.appendChild(installBtn);
}
installBtn.href = data.installUrl;

let resetBtn = document.getElementById('resetBtn');
if (!resetBtn) {
  resetBtn = document.createElement('button');
  resetBtn.id = 'resetBtn';
  resetBtn.textContent = '🔁 Tải ứng dụng khác';
  resetBtn.className = downloadLink.className + ' bg-gray-500 hover:from-gray-600 hover:to-gray-500 mt-2';
  resetBtn.addEventListener('click', () => location.reload());
  downloadLink.parentNode.appendChild(resetBtn);
}
        transition(elements.step3, elements.result);
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
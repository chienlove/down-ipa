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
  const toastContainer = document.createElement('div');
  toastContainer.id = 'toast-container';
  toastContainer.className = 'fixed top-4 right-4 z-50 space-y-2 w-80';
  document.body.appendChild(toastContainer);

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
      .action-buttons {
        display: flex;
        gap: 12px;
        margin-top: 16px;
      }
      .action-buttons button {
        flex: 1;
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
    const buttons = [elements.loginBtn, elements.verifyBtn, elements.downloadBtn];
    
    if (loading) {
      elements.progressBar.classList.add('progress-loading');
      buttons.forEach(btn => {
        btn.classList.add('button-loading');
        btn.disabled = true;
      });
    } else {
      elements.progressBar.classList.remove('progress-loading');
      buttons.forEach(btn => {
        btn.classList.remove('button-loading');
        btn.disabled = false;
      });
    }
  };

  const resetForm = () => {
    state.APPLE_ID = '';
    state.PASSWORD = '';
    state.CODE = '';
    state.verified2FA = false;
    state.dsid = null;
    state.requires2FA = false;
    
    elements.appleIdInput.value = '';
    elements.passwordInput.value = '';
    elements.verificationCodeInput.value = '';
    elements.appIdInput.value = '';
    elements.appVerInput.value = '';
    
    // Reset to step 3 (download form) instead of step 1
    elements.step1.classList.add('hidden');
    elements.step2.classList.add('hidden');
    elements.result.classList.add('hidden');
    elements.step3.classList.remove('hidden');
    setProgress(3);
  };

  const handle2FARedirect = (responseData) => {
    state.requires2FA = true;
    state.verified2FA = false;
    state.dsid = responseData.dsid || null;
    
    let message = responseData.message || '';
    if (message.includes('MZFinance.BadLogin.Configurator_message')) {
      message = 'Thiết bị cần xác minh bảo mật. Vui lòng kiểm tra thiết bị tin cậy của bạn.';
    } else if (message.toLowerCase().includes('code')) {
      message = 'Vui lòng nhập mã xác minh 6 chữ số được gửi đến thiết bị tin cậy.';
    }

    elements.verifyMessage.textContent = message || 'Vui lòng nhập mã xác minh 6 chữ số';
    
    elements.step2.style.display = 'block';
    elements.step2.classList.remove('hidden');
    transition(elements.step1, elements.step2);
    setProgress(2);
  };

  /* ========== EVENT HANDLERS ========== */
  elements.togglePassword.addEventListener('click', () => {
    const isPassword = elements.passwordInput.type === 'password';
    elements.passwordInput.type = isPassword ? 'text' : 'password';
    elements.eyeIcon.innerHTML = isPassword
      ? `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.966 9.966 0 012.842-4.275m3.763-2.174A9.977 9.977 0 0112 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`
      : `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
  });

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

      if (!response.ok) {
        showError(data.error || 'Lỗi từ máy chủ.');
        return;
      }

      if (data.require2FA) {
        handle2FARedirect(data);
        return;
      }

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

      if (!response.ok) {
        showError(data.error || 'Xác minh thất bại.');
        return;
      }

      if (data.success) {
        state.CODE = CODE;
        state.verified2FA = true;
        state.dsid = data.dsid || state.dsid;
        showToast('Xác thực 2FA thành công!');

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

      if (data.require2FA) {
        handle2FARedirect(data);
      } else if (data.success) {
        // Display app info
        document.getElementById('appName').textContent = data.appInfo.name;
        document.getElementById('appAuthor').textContent = data.appInfo.artist;
        document.getElementById('appVersion').textContent = data.appInfo.version;
        document.getElementById('appBundleId').textContent = data.appInfo.bundleId;
        document.getElementById('appDate').textContent = data.appInfo.releaseDate;
        
        // Update download link
        const downloadLink = document.getElementById('downloadLink');
        downloadLink.href = data.downloadUrl;
        downloadLink.download = data.fileName;
        
        // Create action buttons container
        const actionButtons = document.createElement('div');
        actionButtons.className = 'action-buttons';
        
        // Add install button if available
        if (data.installUrl) {
          const installButton = document.createElement('button');
          installButton.className = 'w-full bg-gradient-to-r from-purple-600 to-purple-500 text-white py-3 px-4 rounded-lg hover:from-purple-700 hover:to-purple-600 transition-all duration-300 font-semibold flex items-center justify-center shadow-md hover:shadow-lg';
          installButton.innerHTML = `
            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
            </svg>
            Cài đặt trực tiếp
          `;
          installButton.onclick = () => {
            window.location.href = data.installUrl;
          };
          actionButtons.appendChild(installButton);
        }
        
        // Add "Download Another App" button
        const anotherAppButton = document.createElement('button');
        anotherAppButton.className = 'w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white py-3 px-4 rounded-lg hover:from-blue-700 hover:to-blue-600 transition-all duration-300 font-semibold flex items-center justify-center shadow-md hover:shadow-lg';
        anotherAppButton.innerHTML = `
          <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Tải ứng dụng khác
        `;
        anotherAppButton.onclick = resetForm;
        actionButtons.appendChild(anotherAppButton);
        
        // Update buttons in DOM
        const existingButtons = document.querySelector('.action-buttons');
        if (existingButtons) {
          existingButtons.replaceWith(actionButtons);
        } else {
          downloadLink.insertAdjacentElement('afterend', actionButtons);
        }
        
        transition(elements.step3, elements.result);
        setProgress(4);
      } else {
        showError(data.error || 'Tải ứng dụng thất bại.');
      }
    } catch (error) {
      showError('Không thể kết nối tới máy chủ.');
    } finally {
      setLoading(false);
    }
  });
});
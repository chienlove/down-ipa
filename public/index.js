document.addEventListener('DOMContentLoaded', () => {
  console.log('main.js loaded'); // Debug: Xác nhận file được tải

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
    appleIdInput: document.getElementById('APPLE_ID'),
    verificationCodeInput: document.getElementById('VERIFICATION_CODE'),
    appIdInput: document.getElementById('APPID'),
    appVerInput: document.getElementById('APP_VER_ID')
  };

  // Kiểm tra DOM elements
  Object.keys(elements).forEach(key => {
    if (!elements[key]) console.error(`DOM element ${key} not found`);
  });

  // App State
  const state = {
    APPLE_ID: '',
    PASSWORD: '',
    CODE: '',
    verified2FA: false,
    dsid: null,
    requires2FA: false,
    requestId: null,
  };

  let isLoading = false;
  let eventSource = null;

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
    `;
    document.head.appendChild(style);
  };
  addStyles();

  /* ========== CORE FUNCTIONS ========== */

  const showToast = (message, type = 'success') => {
    console.log(`Toast: ${message}, Type: ${type}`); // Debug
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
    console.log(`Error: ${msg}`); // Debug
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
    console.log(`Transition from ${from.id} to ${to.id}`); // Debug
    from.classList.add('animate__fadeOut');
    setTimeout(() => {
      from.classList.add('hidden');
      from.classList.remove('animate__fadeOut');
      to.classList.remove('hidden');
      to.classList.add('animate__fadeIn');
      setTimeout(() => to.classList.remove('animate__fadeIn'), 500);
    }, 300);
  };

  const setProgress = (stepOrPercent) => {
    console.log(`Set progress: ${stepOrPercent}`); // Debug
    if (typeof stepOrPercent === 'number') {
      elements.progressBar.style.width = `${stepOrPercent}%`;
    } else {
      const map = { 1: '25%', 2: '60%', 3: '90%', 4: '100%' };
      elements.progressBar.style.width = map[stepOrPercent] || '0%';
    }
  };

  const setLoading = (loading) => {
    console.log(`Set loading: ${loading}`); // Debug
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
    console.log('Handle 2FA redirect:', responseData); // Debug
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

    transition(elements.step3, elements.step2);
    setProgress(2);
  };

  const listenProgress = (requestId) => {
    console.log(`Start SSE for requestId: ${requestId}`); // Debug
    if (eventSource) {
      console.log('Closing existing EventSource');
      eventSource.close();
    }

    eventSource = new EventSource(`/download-progress/${requestId}`);
    eventSource.onopen = () => {
      console.log('SSE connection opened'); // Debug
    };

    eventSource.onmessage = (event) => {
      console.log('SSE message received:', event.data); // Debug
      try {
        const data = JSON.parse(event.data);
        console.log(`Progress: ${data.progress}%`); // Debug
        setProgress(data.progress);
        showToast(`Tiến trình: ${data.progress}%`, 'success');

        if (data.status === 'complete') {
          console.log('Download complete:', data); // Debug
          document.getElementById('appName').textContent = data.appInfo?.name || 'Unknown';
          document.getElementById('appAuthor').textContent = data.appInfo?.artist || 'Unknown';
          document.getElementById('appVersion').textContent = data.appInfo?.version || 'Unknown';
          document.getElementById('appBundleId').textContent = data.appInfo?.bundleId || 'Unknown';
          document.getElementById('appDate').textContent = data.appInfo?.releaseDate || 'Unknown';
          const downloadLink = document.getElementById('downloadLink');
          downloadLink.href = data.downloadUrl;
          downloadLink.download = data.fileName || 'app.ipa';
          const installLink = document.getElementById('installLink');
          if (data.installUrl) {
            installLink.href = data.installUrl;
            installLink.classList.remove('hidden');
          } else {
            installLink.classList.add('hidden');
          }

          showToast('Tải thành công!', 'success');
          transition(elements.step3, elements.result);
          setProgress(4);
          eventSource.close();
          eventSource = null;
          console.log('SSE closed after completion'); // Debug
        } else if (data.status === 'error') {
          console.error('SSE error:', data.error); // Debug
          showError(data.error || 'Tải ứng dụng thất bại.');
          showToast('Lỗi tải ứng dụng!', 'error');
          setLoading(false);
          eventSource.close();
          eventSource = null;
          console.log('SSE closed after error'); // Debug
        }
      } catch (error) {
        console.error('SSE parse error:', error, event.data); // Debug
        showError('Lỗi xử lý tiến trình tải.');
        showToast('Lỗi tiến trình!', 'error');
        setLoading(false);
      }
    };

    eventSource.onerror = () => {
      console.error('SSE connection error'); // Debug
      showError('Mất kết nối với server. Đang thử kết nối lại...');
      showToast('Lỗi kết nối!', 'error');
      setLoading(false);
      eventSource.close();
      eventSource = null;
      // Thử reconnect sau 5s
      setTimeout(() => {
        console.log('Reconnecting SSE...'); // Debug
        listenProgress(requestId);
      }, 5000);
    };
  };

  /* ========== EVENT HANDLERS ========== */

  elements.togglePassword.addEventListener('click', () => {
    console.log('Toggle password clicked'); // Debug
    const isPassword = elements.passwordInput.type === 'password';
    elements.passwordInput.type = isPassword ? 'text' : 'password';
    elements.togglePassword.className = isPassword ? 'fas fa-eye-slash password-toggle' : 'fas fa-eye password-toggle';
  });

  elements.loginBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    console.log('Login button clicked'); // Debug
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

      if (data.require2FA || data.authType === '2fa') {
        handle2FARedirect(data);
        setLoading(false);
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
      console.error('Auth error:', error);
      showError('Không thể kết nối tới máy chủ.');
    } finally {
      setLoading(false);
    }
  });

  elements.verifyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    console.log('Verify button clicked'); // Debug
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
        setLoading(false);
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
      console.error('Verify error:', error);
      showError('Không thể kết nối tới máy chủ.');
    } finally {
      setLoading(false);
    }
  });

  elements.downloadBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    console.log('Download button clicked'); // Debug
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
      console.log('Sending /download request'); // Debug
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
        setLoading(false);
      } else if (data.success && data.requestId) {
        state.requestId = data.requestId;
        console.log(`Starting progress listener for requestId: ${data.requestId}`); // Debug
        listenProgress(data.requestId);
      } else {
        showError(data.error || 'Tải ứng dụng thất bại.');
        setLoading(false);
      }
    } catch (error) {
      console.error('Download error:', error);
      showError('Không thể kết nối tới máy chủ.');
      setLoading(false);
    }
  });
});
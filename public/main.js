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

  // ==================== UTILITY FUNCTIONS ====================
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'success' ? '✓' : '✗'}</span>
      <span>${message}</span>
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
  }

  function showError(msg) {
    elements.errorMessage.textContent = msg;
    elements.errorBox.classList.remove('hidden');
  }

  function hideError() {
    elements.errorBox.classList.add('hidden');
  }

  function transition(from, to) {
    from.classList.add('hidden');
    to.classList.remove('hidden');
  }

  function setProgress(step) {
    const progressMap = { 1: '25%', 2: '60%', 3: '90%', 4: '100%' };
    elements.progressBar.style.width = progressMap[step] || '0%';
  }

  function setLoading(loading) {
    isLoading = loading;
    document.querySelectorAll('button').forEach(btn => {
      btn.disabled = loading;
    });
  }

  // ==================== DEBUG CONSOLE ====================
  const debugConsole = document.createElement('div');
  debugConsole.id = 'debug-console';
  debugConsole.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 150px;
    background: rgba(0,0,0,0.8);
    color: white;
    padding: 10px;
    overflow-y: auto;
    z-index: 1000;
    font-family: monospace;
    font-size: 12px;
    display: none;
  `;
  document.body.appendChild(debugConsole);

  function debugLog(message) {
    const now = new Date().toLocaleTimeString();
    debugConsole.innerHTML += `<div>[${now}] ${message}</div>`;
    debugConsole.scrollTop = debugConsole.scrollHeight;
  }

  // Toggle debug console with Ctrl+D
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'd') {
      debugConsole.style.display = debugConsole.style.display === 'none' ? 'block' : 'none';
    }
  });

  // ==================== EVENT HANDLERS ====================
  elements.togglePassword.addEventListener('click', () => {
    const isPassword = elements.passwordInput.type === 'password';
    elements.passwordInput.type = isPassword ? 'text' : 'password';
  });

  // LOGIN HANDLER
  elements.loginBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isLoading) return;
    
    debugLog('=== BẮT ĐẦU ĐĂNG NHẬP ===');
    hideError();
    setLoading(true);
    setProgress(1);

    const APPLE_ID = elements.appleIdInput.value.trim();
    const PASSWORD = elements.passwordInput.value;

    if (!APPLE_ID || !PASSWORD) {
      showError('Vui lòng nhập Apple ID và mật khẩu');
      setLoading(false);
      return;
    }

    state.APPLE_ID = APPLE_ID;
    state.PASSWORD = PASSWORD;

    try {
      debugLog(`Gửi yêu cầu đăng nhập cho: ${APPLE_ID}`);
      const response = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ APPLE_ID, PASSWORD })
      });

      const data = await response.json();
      debugLog(`Phản hồi từ server: ${JSON.stringify(data)}`);

      if (!response.ok) {
        throw new Error(data.error || 'Lỗi từ máy chủ');
      }

      // Xử lý 2FA
      if (data.require2FA) {
        debugLog('Yêu cầu xác thực 2FA');
        state.requires2FA = true;
        state.dsid = data.dsid;
        
        elements.verifyMessage.textContent = data.message || 'Vui lòng nhập mã xác minh 2FA';
        elements.step2.style.display = 'block';
        transition(elements.step1, elements.step2);
        setProgress(2);
        return;
      }

      // Đăng nhập thành công
      if (data.success) {
        debugLog('Đăng nhập thành công không cần 2FA');
        state.verified2FA = true;
        state.dsid = data.dsid;
        showToast('Đăng nhập thành công!');
        transition(elements.step1, elements.step3);
        setProgress(3);
        return;
      }

      // Sai mật khẩu
      showError(data.error || 'Sai tài khoản hoặc mật khẩu');
      debugLog('Đăng nhập thất bại: Sai thông tin');

    } catch (error) {
      debugLog(`Lỗi đăng nhập: ${error.message}`);
      showError(error.message || 'Lỗi kết nối đến máy chủ');
    } finally {
      setLoading(false);
    }
  });

  // VERIFY 2FA HANDLER
  elements.verifyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isLoading) return;
    
    debugLog('=== XÁC THỰC 2FA ===');
    hideError();
    setLoading(true);
    setProgress(2);

    const CODE = elements.verificationCodeInput.value.trim();
    if (CODE.length !== 6) {
      showError('Mã xác minh phải có 6 chữ số');
      setLoading(false);
      return;
    }

    try {
      debugLog(`Gửi mã xác minh: ${CODE}`);
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
      debugLog(`Phản hồi xác minh: ${JSON.stringify(data)}`);

      if (!response.ok) {
        throw new Error(data.error || 'Xác minh thất bại');
      }

      if (data.success) {
        debugLog('Xác thực 2FA thành công');
        state.CODE = CODE;
        state.verified2FA = true;
        state.dsid = data.dsid || state.dsid;
        showToast('Xác thực thành công!');
        
        elements.step2.style.display = 'none';
        transition(elements.step2, elements.step3);
        setProgress(3);
        return;
      }

      // Mã 2FA sai
      showError(data.error || 'Mã xác minh không đúng');
      elements.verificationCodeInput.value = '';
      elements.verificationCodeInput.focus();
      debugLog('Mã 2FA không đúng, yêu cầu nhập lại');

    } catch (error) {
      debugLog(`Lỗi xác minh: ${error.message}`);
      showError(error.message || 'Lỗi kết nối đến máy chủ');
    } finally {
      setLoading(false);
    }
  });

  // DOWNLOAD HANDLER
  elements.downloadBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isLoading) return;
    
    debugLog('=== BẮT ĐẦU TẢI ỨNG DỤNG ===');
    hideError();
    setLoading(true);
    setProgress(3);

    const APPID = elements.appIdInput.value.trim();
    const appVerId = elements.appVerInput.value.trim();

    if (!APPID) {
      showError('Vui lòng nhập App ID');
      setLoading(false);
      return;
    }

    try {
      debugLog(`Gửi yêu cầu tải app: ${APPID}`);
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
      debugLog(`Phản hồi tải app: ${JSON.stringify(data)}`);

      if (data.require2FA) {
        debugLog('Yêu cầu xác thực 2FA khi tải');
        state.requires2FA = true;
        elements.step2.style.display = 'block';
        transition(elements.step3, elements.step2);
        return;
      }

      if (data.success) {
        debugLog('Tải app thành công');
        document.getElementById('appName').textContent = data.appInfo.name;
        document.getElementById('appAuthor').textContent = data.appInfo.artist;
        document.getElementById('appVersion').textContent = data.appInfo.version;
        
        const downloadLink = document.getElementById('downloadLink');
        downloadLink.href = data.downloadUrl;
        downloadLink.download = data.fileName;
        
        transition(elements.step3, elements.result);
        setProgress(4);
        return;
      }

      showError(data.error || 'Tải ứng dụng thất bại');

    } catch (error) {
      debugLog(`Lỗi tải app: ${error.message}`);
      showError(error.message || 'Lỗi kết nối đến máy chủ');
    } finally {
      setLoading(false);
    }
  });

  // ==================== INITIAL SETUP ====================
  // Ẩn step 2 và 3 khi khởi động
  elements.step2.style.display = 'none';
  elements.step3.style.display = 'none';
});
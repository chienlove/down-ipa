document.addEventListener('DOMContentLoaded', () => {
  console.log('index.js loaded');
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
    togglePassword: document.getElementById('togglePassword'),
    passwordInput: document.getElementById('PASSWORD'),
    appleIdInput: document.getElementById('APPLE_ID'),
    verificationCodeInput: document.getElementById('VERIFICATION_CODE'),
    appIdInput: document.getElementById('APPID'),
    appVerInput: document.getElementById('APP_VER_ID'),
    progressBar: document.getElementById('progressBar') // Thêm thanh tiến trình
  };

  // Kiểm tra DOM elements an toàn
  Object.keys(elements).forEach(key => {
    if (!elements[key]) {
      console.warn(`⚠ DOM element "${key}" not found`);
    }
  });

  // Hàm showError
  const showError = (msg) => {
    console.log(`Error: ${msg}`);
    if (elements.errorMessage && elements.errorBox) {
      elements.errorMessage.textContent = msg;
      elements.errorBox.classList.remove('hidden');
    } else {
      alert(msg);
    }
  };
  
  const hideError = () => {
    if (elements.errorBox) {
      elements.errorBox.classList.add('hidden');
    } else {
      console.warn('Không tìm thấy phần tử errorBox để ẩn');
    }
  };

  // App State
  const state = {
    APPLE_ID: '',
    PASSWORD: '',
    CODE: '',
    verified2FA: false,
    dsid: null,
    requires2FA: false,
    requestId: null,
    iosVersion: null,
    lastProgressStep: null,
    progressHistory: [] // Theo dõi các mốc progress đã nhận
  };

  let isLoading = false;
  let eventSource = null;
  let deviceOSVersion = null;

  // Detect device iOS version
  function detectIOSVersion() {
    const ua = navigator.userAgent;
    const match = ua.match(/OS (\d+)_(\d+)(?:_(\d+))?/);
    if (match) {
      return `${match[1]}.${match[2]}${match[3] ? `.${match[3]}` : ''}`;
    }
    return 'Unknown';
  }

  deviceOSVersion = detectIOSVersion();
  state.iosVersion = deviceOSVersion;

  /* ========== UI HELPERS ========== */
  
  const toastContainer = document.createElement('div');
  toastContainer.id = 'toast-container';
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);

  const showToast = (message, type = 'success') => {
    console.log(`Toast: ${message}, Type: ${type}`);
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'success' ? '✓' : '✗'}</span>
      <span>${message}</span>
    `;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    setTimeout(() => toast.remove(), 3000);
  };

  const transition = (from, to) => {
    console.log(`Transition from ${from?.id} to ${to?.id}`);
    if (!from || !to) {
      console.error('Invalid transition elements:', { from, to });
      return;
    }
    [elements.step1, elements.step2, elements.step3, elements.result].forEach(step => {
      if (step && step !== to) {
        step.classList.add('hidden');
        step.style.display = 'none';
      }
    });
    from.classList.add('fade-out');
    setTimeout(() => {
      from.classList.add('hidden');
      from.style.display = 'none';
      from.classList.remove('fade-out');
      to.classList.remove('hidden');
      to.style.display = 'block';
      to.classList.add('fade-in');
      setTimeout(() => to.classList.remove('fade-in'), 300);
    }, 300);
  };

  const setProgress = (stepOrPercent) => {
    console.log(`Set progress: ${stepOrPercent}`);
    if (typeof stepOrPercent === 'number') {
      elements.progressBar.style.width = `${stepOrPercent}%`;
    } else {
      const map = { 1: '25%', 2: '60%', 3: '90%', 4: '100%' };
      elements.progressBar.style.width = map[stepOrPercent] || '0%';
    }
  };

  // Hiển thị chi tiết tiến trình
  const updateProgressSteps = (message, status = 'pending') => {
    if (!elements.progressSteps) return;
    if (state.lastProgressStep === message) return; // Ngăn lặp lại bước
    state.lastProgressStep = message;
    const step = document.createElement('div');
    step.className = `progress-step ${status}`;
    step.innerHTML = `
      <span class="progress-icon">${status === 'success' ? '✓' : status === 'error' ? '✗' : '⏳'}</span>
      <span>${message}</span>
    `;
    elements.progressSteps.appendChild(step);
    // Cuộn xuống cuối để thấy bước mới nhất
    elements.progressSteps.scrollTop = elements.progressSteps.scrollHeight;
  };

  const clearProgressSteps = () => {
    if (elements.progressSteps) {
      elements.progressSteps.innerHTML = '';
      state.lastProgressStep = null; // Reset bước cuối
      state.progressHistory = []; // Reset lịch sử progress
      elements.progressBar.style.width = '0%'; // Reset thanh tiến trình về 0
    }
  };

  const setLoading = (loading) => {
    console.log(`Set loading: ${loading}`);
    isLoading = loading;
    if (!elements.progressBar) {
      console.error('Progress bar element not found');
      showError('Lỗi giao diện: Thanh tiến trình không được tìm thấy');
      return;
    }
    if (loading) {
      elements.progressBar.classList.add('progress-loading');
      document.querySelectorAll('button').forEach(btn => {
        if (btn) {
          btn.classList.add('button-loading');
          btn.disabled = true;
        }
      });
    } else {
      setTimeout(() => {
        elements.progressBar.classList.remove('progress-loading');
        document.querySelectorAll('button').forEach(btn => {
          if (btn) {
            btn.classList.remove('button-loading');
            btn.disabled = false;
          }
        });
      }, 300);
    }
  };

  const compareVersions = (version1, version2) => {
    if (!version1 || !version2) return 0;
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    const maxLength = Math.max(v1Parts.length, v2Parts.length);
    
    for (let i = 0; i < maxLength; i++) {
      const v1 = v1Parts[i] || 0;
      const v2 = v2Parts[i] || 0;
      if (v1 > v2) return 1;
      if (v1 < v2) return -1;
    }
    return 0;
  };

  const updateInstallButton = (minimumOSVersion, userIOSVersion, installUrl, downloadUrl) => {
    const installLink = document.getElementById('installLink');
    installLink.href = installUrl || downloadUrl || '#';
    userIOSVersion = userIOSVersion || 'Unknown';
    if (minimumOSVersion === 'Unknown' || userIOSVersion === 'Unknown') {
      installLink.innerHTML = '<i class="fas fa-question-circle mr-2"></i> Không rõ tương thích';
      installLink.classList.remove('compatible', 'incompatible');
      installLink.classList.add('unknown');
      installLink.className = 'px-6 py-3 rounded-lg font-medium text-white bg-yellow-400 flex items-center justify-center';
      installLink.title = 'Không xác định được phiên bản iOS thiết bị';
      document.getElementById('compatNote').className = 'mt-3 px-4 py-3 rounded-lg text-sm bg-yellow-50 text-yellow-700 border border-yellow-300 flex';
      document.getElementById('compatNote').innerHTML = '<i class="fas fa-question-circle mr-2 mt-1"></i>Không xác định được phiên bản iOS thiết bị.';
    } else if (compareVersions(userIOSVersion, minimumOSVersion) >= 0) {
      installLink.innerHTML = '<i class="fas fa-mobile-alt mr-2"></i> Cài trực tiếp';
      installLink.classList.add('compatible');
      installLink.classList.remove('incompatible', 'unknown');
      installLink.className = 'px-6 py-3 rounded-lg font-medium text-white bg-green-500 hover:bg-green-600 flex items-center justify-center';
      installLink.title = `Tương thích với iOS ${userIOSVersion}`;
      document.getElementById('compatNote').className = 'mt-3 px-4 py-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-300 flex';
      document.getElementById('compatNote').innerHTML = `<i class="fas fa-check-circle mr-2 mt-1"></i>Thiết bị iOS ${userIOSVersion} tương thích (yêu cầu iOS ${minimumOSVersion})`;
    } else {
      installLink.innerHTML = '<i class="fas fa-ban mr-2"></i> Không tương thích';
      installLink.classList.add('incompatible');
      installLink.classList.remove('compatible', 'unknown');
      installLink.className = 'px-6 py-3 rounded-lg font-medium text-white bg-red-500 opacity-80 cursor-not-allowed flex items-center justify-center';
      installLink.title = `Yêu cầu iOS ${minimumOSVersion}, thiết bị của bạn là iOS ${userIOSVersion}`;
      document.getElementById('compatNote').className = 'mt-3 px-4 py-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-300 flex';
      document.getElementById('compatNote').innerHTML = `<i class="fas fa-times-circle mr-2 mt-1"></i>Thiết bị (${userIOSVersion}) KHÔNG tương thích. Yêu cầu iOS ${minimumOSVersion}.`;
    }
  };

  const handle2FARedirect = (responseData) => {
    console.log('Handle 2FA redirect:', responseData);
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
    transition(elements.step1, elements.step2);
    setProgress(2);
    setLoading(false);
  };

  const listenProgress = (requestId) => {
    console.log(`Start SSE for requestId: ${requestId}`);
    if (eventSource) {
      console.log('Closing existing EventSource');
      eventSource.close();
    }

    eventSource = new EventSource(`/download-progress/${requestId}`);
    eventSource.onopen = () => {
      console.log('SSE connection opened');
      updateProgressSteps('Đang kết nối với máy chủ', 'success');
    };

    eventSource.onmessage = (event) => {
      console.log('SSE message received:', event.data);
      try {
        const data = JSON.parse(event.data);
        console.log(`Progress: ${data.progress}%, Status: ${data.status}`);

        // Theo dõi lịch sử progress
        if (!state.progressHistory.includes(data.progress)) {
          state.progressHistory.push(data.progress);
        }

        // Ánh xạ tiến trình thành các bước chi tiết
        let stepMessage = '';
        switch (data.progress) {
          case 10:
            stepMessage = 'Đang xác thực Apple ID';
            break;
          case 20:
            stepMessage = 'Đang tải file IPA';
            break;
          case 40:
            stepMessage = 'Đang giải nén IPA';
            break;
          case 60:
            stepMessage = 'Đang ký IPA';
            break;
          case 80:
            stepMessage = 'Đang tải IPA lên';
            break;
          case 100:
            stepMessage = 'Hoàn tất tải ứng dụng';
            break;
          default:
            console.log(`Ignoring unknown progress: ${data.progress}`);
            return; // Bỏ qua nếu progress không khớp
        }
        if (stepMessage) updateProgressSteps(stepMessage, 'success');

        // Xử lý khi hoàn thành
        if (data.status === 'complete') {
          console.log('Download complete:', data);
          // Đợi 500ms để hiển thị bước 100 trước khi chuyển
          setTimeout(() => {
            const appInfo = data.appInfo || {};
            document.getElementById('appName').textContent = appInfo.name || 'Unknown';
            document.getElementById('appAuthor').textContent = appInfo.artist || 'Unknown';
            document.getElementById('appVersion').textContent = appInfo.version || 'Unknown';
            document.getElementById('appBundleId').textContent = appInfo.bundleId || 'Unknown';
            document.getElementById('appDate').textContent = appInfo.releaseDate || 'Unknown';
            document.getElementById('minimumOSVersion').textContent = appInfo.minimumOSVersion || 'Unknown';
            const downloadLink = document.getElementById('downloadLink');
            downloadLink.href = data.downloadUrl || '#';
            downloadLink.download = data.fileName || 'app.ipa';
            const installLink = document.getElementById('installLink');
            installLink.dataset.href = data.installUrl || '#';
            if (data.installUrl) {
              installLink.href = data.installUrl;
              installLink.classList.remove('hidden');
            } else {
              installLink.classList.add('hidden');
            }

            updateInstallButton(appInfo.minimumOSVersion, deviceOSVersion, data.installUrl, data.downloadUrl);
            transition(elements.step3, elements.result);
            setProgress(4);
            setLoading(false);
            eventSource.close();
            eventSource = null;
            console.log('SSE closed after completion');
          }, 500);
        } else if (data.status === 'error') {
          console.error('SSE error:', data.error);
          showError(data.error || 'Tải ứng dụng thất bại.');
          updateProgressSteps('Lỗi tải ứng dụng', 'error');
          setLoading(false);
          eventSource.close();
          eventSource = null;
          console.log('SSE closed after error');
        }
      } catch (error) {
        console.error('SSE parse error:', error, event.data);
        showError('Lỗi xử lý tiến trình tải.');
        updateProgressSteps('Lỗi xử lý tiến trình', 'error');
        setLoading(false);
        eventSource?.close();
        eventSource = null;
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      // Chỉ hiển thị lỗi nếu chưa nhận status: complete
      if (!state.progressHistory.includes(100)) {
        showError('Mất kết nối với server.');
        updateProgressSteps('Lỗi kết nối với server', 'error');
      }
      setLoading(false);
      eventSource?.close();
      eventSource = null;
    };
  };

  /* ========== EVENT HANDLERS ========== */

  if (elements.loginBtn) {
    elements.loginBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      console.log('Login button clicked');
      if (isLoading) {
        console.log('Login button disabled due to isLoading=true');
        return;
      }
      
      hideError();
      setLoading(true);

      const APPLE_ID = elements.appleIdInput?.value.trim() || '';
      const PASSWORD = elements.passwordInput?.value || '';
      
      if (!APPLE_ID || !PASSWORD) {
        showError('Vui lòng nhập Apple ID và mật khẩu.');
        setLoading(false);
        return;
      }

      state.APPLE_ID = APPLE_ID;
      state.PASSWORD = PASSWORD;

      setProgress(1);

      try {
        console.log('Sending /auth request');
        const response = await fetch('/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ APPLE_ID, PASSWORD })
        });

        console.log('Auth response status:', response.status);
        const data = await response.json();
        console.log('Auth response data:', data);

        if (!response.ok) {
          showError(data.error || 'Lỗi từ máy chủ.');
          setLoading(false);
          return;
        }

        if (data.require2FA || data.authType === '2fa') {
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
          setLoading(false);
        } else {
          showError(data.error || 'Đăng nhập thất bại');
          setLoading(false);
        }
      } catch (error) {
        console.error('Auth error:', error.message);
        showError('Không thể kết nối tới máy chủ.');
        setLoading(false);
      }
    });
  } else {
    console.error('loginBtn not found in DOM');
    showError('Lỗi giao diện: Nút đăng nhập không được tìm thấy.');
  }

  if (elements.togglePassword) {
    elements.togglePassword.addEventListener('click', () => {
      console.log('Toggle password clicked');
      const isPassword = elements.passwordInput.type === 'password';
      elements.passwordInput.type = isPassword ? 'text' : 'password';
      elements.togglePassword.className = isPassword ? 'fas fa-eye-slash password-toggle' : 'fas fa-eye password-toggle';
    });
  }

  if (elements.verifyBtn) {
    elements.verifyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      console.log('Verify button clicked');
      if (isLoading) return;
      
      hideError();
      setLoading(true);

      const CODE = elements.verificationCodeInput?.value.trim() || '';
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
          elements.verificationCodeInput.value = '';
          elements.verifyMessage.textContent = '';
          transition(elements.step2, elements.step3);
          setProgress(3);
          setLoading(false);
        } else {
          showError(data.error || 'Mã xác minh không đúng.');
          setLoading(false);
        }
      } catch (error) {
        console.error('Verify error:', error);
        showError('Không thể kết nối tới máy chủ.');
        setLoading(false);
      }
    });
  } else {
    console.error('verifyBtn not found in DOM');
    showError('Lỗi giao diện: Nút xác thực không được tìm thấy.');
  }

  if (elements.downloadBtn) {
    elements.downloadBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      console.log('Download button clicked');
      if (isLoading) return;
      
      hideError();
      setLoading(true);
      clearProgressSteps(); // Xóa sạch tiến trình trước khi bắt đầu
      updateProgressSteps('Bắt đầu quá trình tải', 'pending');

      const APPID = elements.appIdInput?.value.trim().match(/id(\d+)|^\d+$/)?.[1] || '';
      const appVerId = elements.appVerInput?.value.trim() || '';
      state.iosVersion = deviceOSVersion;

      if (!APPID) {
        showError('Vui lòng nhập App ID hợp lệ.');
        updateProgressSteps('Lỗi: App ID không hợp lệ', 'error');
        setLoading(false);
        return;
      }

      if (state.requires2FA && !state.verified2FA) {
        showError('Vui lòng hoàn thành xác thực 2FA trước khi tải.');
        updateProgressSteps('Lỗi: Yêu cầu xác thực 2FA', 'error');
        setLoading(false);
        transition(elements.step3, elements.step2);
        return;
      }

      setProgress(3);

      try {
        console.log('Sending /download request');
        updateProgressSteps('Gửi yêu cầu tải đến máy chủ', 'pending');
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
          updateProgressSteps('Yêu cầu xác thực 2FA', 'pending');
          handle2FARedirect(data);
          setLoading(false);
        } else if (data.success && data.requestId) {
          state.requestId = data.requestId;
          console.log(`Starting progress listener for requestId: ${data.requestId}`);
          updateProgressSteps('Khởi tạo tiến trình tải', 'success');
          listenProgress(data.requestId);
        } else {
          showError(data.error || 'Tải ứng dụng thất bại.');
          updateProgressSteps('Lỗi tải ứng dụng', 'error');
          setLoading(false);
        }
      } catch (error) {
        console.error('Download error:', error);
        showError('Không thể kết nối tới máy chủ.');
        updateProgressSteps('Lỗi kết nối máy chủ', 'error');
        setLoading(false);
      }
    });
  }
});
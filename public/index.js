document.addEventListener('DOMContentLoaded', () => {
  console.log('index.js loaded');

  const $ = (id) => document.getElementById(id);
  const elements = {
    step1: $('step1'),
    step2: $('step2'),
    step3: $('step3'),
    result: $('result'),
    loginBtn: $('loginBtn'),
    verifyBtn: $('verifyBtn'),
    backToStep1: $('backToStep1'),
    downloadBtn: $('downloadBtn'),
    downloadAnotherBtn: $('downloadAnotherBtn'),
    errorBox: $('error'),
    errorMessage: $('errorMessage'),
    verifyMessage: $('verifyMessage'),
    progressBar: $('progressBar'),
    progressWrap: $('progressWrap'),
    progressSteps: $('progressSteps'),
    togglePassword: $('togglePassword'),
    passwordInput: $('PASSWORD'),
    appleIdInput: $('APPLE_ID'),
    verificationCodeInput: $('VERIFICATION_CODE'),
    appIdInput: $('APPID'),
    appVerInput: $('APP_VER_ID'),
    installLink: $('installLink'),
    downloadLink: $('downloadLink'),
    sessionNotice: $('sessionNotice'),
    toastContainer: $('toast-container'),
    recaptchaContainer: $('recaptcha-container')
  };

  const showError = (msg) => {
    if (elements.errorMessage && elements.errorBox) {
      elements.errorMessage.textContent = msg || 'Đã xảy ra lỗi.';
      elements.errorBox.classList.remove('hidden');
    } else {
      alert(msg || 'Đã xảy ra lỗi.');
    }
  };
  const hideError = () => { if (elements.errorBox) elements.errorBox.classList.add('hidden'); };

  const state = {
    APPLE_ID: '', PASSWORD: '', CODE: '',
    verified2FA: false, dsid: null, requires2FA: false,
    requestId: null, iosVersion: null, lastProgressStep: null,
    progressHistory: []
  };

  // ✅ [THÊM MỚI] Hàm lấy Token bảo mật từ server
  const getPurchaseToken = async () => {
    try {
      const res = await fetch('/purchase-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.success ? data.token : null;
    } catch (e) {
      console.error('Lỗi lấy token:', e);
      return null;
    }
  };
  // ✅ [KẾT THÚC THÊM MỚI]

  let isLoading = false;
  let eventSource = null;

  const safeCloseEventSource = () => { if (eventSource) { try { eventSource.close(); } catch {} eventSource = null; } };

  const detectIOSVersion = () => {
    const ua = navigator.userAgent;
    const m = ua.match(/OS (\d+)_(\d+)(?:_(\d+))?/);
    return m ? `${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}` : 'Unknown';
  };
  const deviceOSVersion = detectIOSVersion();
  state.iosVersion = deviceOSVersion;

  const showToast = (message, type = 'success') => {
    if (!elements.toastContainer) return console.warn('toast container not found');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'toast-error' : 'toast-success'}`;
    toast.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : '✗'}</span><span>${message}</span>`;
    elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => toast.remove(), 3000);
  };

  const transition = (from, to) => {
    if (!from || !to) return;
    [elements.step1, elements.step2, elements.step3, elements.result].forEach(step => {
      if (step && step !== to) { step.classList.add('hidden'); step.style.display = 'none'; }
    });
    from.classList.add('fade-out');
    setTimeout(() => {
      from.classList.add('hidden'); from.style.display = 'none'; from.classList.remove('fade-out');
      to.classList.remove('hidden'); to.style.display = 'block'; to.classList.add('fade-in');
      setTimeout(() => to.classList.remove('fade-in'), 300);
    }, 300);
  };

  const setProgress = (percent) => {
    if (!elements.progressBar) return;
    elements.progressBar.style.width = `${percent}%`;
    elements.progressBar.classList.remove('hidden');
    elements.progressBar.style.display = 'block';
    if (elements.progressWrap) { elements.progressWrap.classList.remove('hidden'); elements.progressWrap.style.display = 'block'; }
  };

  const updateProgressSteps = (message, status = 'pending') => {
    if (!elements.progressSteps) return;
    if (state.lastProgressStep === message) return;
    state.lastProgressStep = message;
    const step = document.createElement('div');
    step.className = `progress-step ${status}`;
    step.innerHTML = `<span class="progress-icon">${status === 'success' ? '✓' : status === 'error' ? '✗' : '⏳'}</span><span>${message}</span>`;
    elements.progressSteps.appendChild(step);
    elements.progressSteps.scrollTop = elements.progressSteps.scrollHeight;
  };

  const clearProgressSteps = () => {
    if (elements.progressSteps) {
      elements.progressSteps.innerHTML = '';
      state.lastProgressStep = null;
      state.progressHistory = [];
    }
  };

  const setLoading = (loading) => {
    isLoading = loading;
    if (!elements.progressBar) return;
    if (loading) {
      elements.progressBar.classList.remove('hidden');
      elements.progressBar.style.display = 'block';
      if (elements.progressWrap) { elements.progressWrap.classList.remove('hidden'); elements.progressWrap.style.display = 'block'; }
      document.querySelectorAll('button').forEach(btn => { if (btn) { btn.classList.add('button-loading'); btn.disabled = true; } });
    } else {
      setTimeout(() => { document.querySelectorAll('button').forEach(btn => { if (btn) { btn.classList.remove('button-loading'); btn.disabled = false; } }); }, 300);
    }
  };

  const compareVersions = (a, b) => {
    if (!a || !b) return 0;
    const v1=a.split('.').map(Number), v2=b.split('.').map(Number), L=Math.max(v1.length,v2.length);
    for (let i=0;i<L;i++){ const x=v1[i]||0,y=v2[i]||0; if(x>y)return 1; if(x<y)return -1; }
    return 0;
  };

  const updateInstallButton = (minOS, userOS, installUrl, downloadUrl) => {
    const installLink = elements.installLink;
    const compatNote = $('compatNote');
    userOS = userOS || 'Unknown';
    installLink.className = 'px-6 py-3 rounded-lg font-medium text-white flex items-center justify-center';
    if (minOS === 'Unknown' || userOS === 'Unknown') {
      installLink.innerHTML = '<i class="fas fa-question-circle mr-2"></i> Không rõ tương thích';
      installLink.classList.add('bg-yellow-400');
      compatNote.className = 'mt-3 px-4 py-3 rounded-lg text-sm bg-yellow-50 text-yellow-700 border border-yellow-300 flex';
      compatNote.innerHTML = '<i class="fas fa-question-circle mr-2 mt-1"></i>Không xác định được phiên bản iOS thiết bị.';
    } else if (compareVersions(userOS, minOS) >= 0) {
      installLink.innerHTML = '<i class="fas fa-mobile-alt mr-2"></i> Cài trực tiếp';
      installLink.classList.add('bg-green-500', 'hover:bg-green-600');
      compatNote.className = 'mt-3 px-4 py-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-300 flex';
      compatNote.innerHTML = `<i class="fas fa-check-circle mr-2 mt-1"></i>Thiết bị iOS ${userOS} tương thích (yêu cầu iOS ${minOS})`;
    } else {
      installLink.innerHTML = '<i class="fas fa-ban mr-2"></i> Không tương thích';
      installLink.classList.add('bg-red-500', 'opacity-80', 'cursor-not-allowed');
      compatNote.className = 'mt-3 px-4 py-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-300 flex';
      compatNote.innerHTML = `<i class="fas fa-times-circle mr-2 mt-1"></i>Thiết bị (${userOS}) KHÔNG tương thích. Yêu cầu iOS ${minOS}.`;
    }
  };

  const handle2FARedirect = (responseData) => {
    state.requires2FA = true;
    state.verified2FA = false;
    state.dsid = responseData.dsid || null;
    let message = responseData.message || '';
    if (message.includes('MZFinance.BadLogin.Configurator_message')) message = 'Thiết bị cần xác minh bảo mật. Vui lòng kiểm tra thiết bị tin cậy của bạn.';
    else if (message.toLowerCase().includes('code')) message = 'Vui lòng nhập mã xác minh 6 chữ số được gửi đến thiết bị tin cậy.';
    elements.verifyMessage.textContent = message || 'Vui lòng nhập mã xác minh 6 chữ số';
    transition(elements.step1, elements.step2);
    setProgress(2);
    setLoading(false);
  };

  // SỬA: Cập nhật hàm mapServerErrorToMessage để xử lý lỗi cụ thể
  const mapServerErrorToMessage = (error, message) => {
    const raw = `${error || ''} ${message || ''}`.trim();
    
    if (raw.includes('SERVER_BUSY')) return 'Máy chủ đang bận, vui lòng thử lại sau.';
    if (raw.includes('RATE_LIMIT_EXCEEDED') || raw.includes('too many')) return 'Quá nhiều yêu cầu. Vui lòng đợi 15 phút rồi thử lại.';
    if (raw.includes('APP_NOT_OWNED') || raw.includes('client not found')) return 'Ứng dụng này chưa được mua hoặc không có trong mục đã mua của Apple ID. Vui lòng kiểm tra lại.';
    if (raw.startsWith('FILE_TOO_LARGE') || raw.includes('File IPA vượt quá giới hạn')) return 'Ứng dụng vượt quá dung lượng cho phép (300MB). Vui lòng chọn phiên bản nhỏ hơn.';
    if (raw.startsWith('OUT_OF_MEMORY') || raw.includes('Insufficient memory')) return 'Máy chủ không đủ RAM để xử lý. Vui lòng thử lại sau.';
    if (raw === 'CANCELLED_BY_CLIENT') return 'Tiến trình đã bị hủy.';
    if (raw.startsWith('RECAPTCHA')) return 'Xác minh reCAPTCHA thất bại. Vui lòng thử lại.';
    if (raw.includes('SESSION_EXPIRED')) return 'Phiên làm việc hết hạn. Vui lòng tải lại trang.';
    
    return message || error || 'Đã xảy ra lỗi không xác định.';
  };

  /* ========== reCAPTCHA explicit render ========== */
  let recaptchaWidgetId = null;
  async function initRecaptcha() {
    try {
      if (!elements.recaptchaContainer) return;
      let siteKey = '';
      try {
        const resp = await fetch('/recaptcha-sitekey', { cache: 'no-store' });
        if (resp.ok) {
          const json = await resp.json();
          siteKey = json?.siteKey || '';
        }
      } catch {}
      if (!siteKey) {
        const dataAttr = elements.recaptchaContainer.getAttribute('data-sitekey');
        if (dataAttr) siteKey = dataAttr;
      }
      if (!siteKey) {
        console.error('Missing reCAPTCHA siteKey.');
        return;
      }
      const renderWhenReady = () => {
        if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
          try {
            recaptchaWidgetId = window.grecaptcha.render(elements.recaptchaContainer, { sitekey: siteKey });
            console.log('reCAPTCHA rendered, widgetId:', recaptchaWidgetId);
          } catch (err) { console.error('grecaptcha.render error:', err); }
        } else {
          setTimeout(renderWhenReady, 200);
        }
      };
      renderWhenReady();
    } catch (e) { console.error('Failed to init reCAPTCHA:', e); }
  }
  initRecaptcha();

  /* ========== SSE listen ========== */
  const listenProgress = (requestId) => {
    if (!requestId) return;
    if (eventSource) safeCloseEventSource();

    elements.progressBar.style.width = '0%';
    elements.progressBar.classList.remove('hidden');
    elements.progressBar.style.display = 'block';
    if (elements.progressWrap) { elements.progressWrap.classList.remove('hidden'); elements.progressWrap.style.display = 'block'; }
    elements.progressSteps.classList.remove('hidden');
    elements.progressSteps.style.display = 'block';

    eventSource = new EventSource(`/download-progress/${requestId}`);
    eventSource.onopen = () => { updateProgressSteps('Đang kết nối với máy chủ', 'success'); };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!state.progressHistory.includes(data.progress)) state.progressHistory.push(data.progress);

        let stepMessage = '';
        if (data.progress < 10) stepMessage = 'Khởi động tải';
        else if (data.progress < 20) stepMessage = 'Đang xác thực Apple ID';
        else if (data.progress < 40) stepMessage = 'Đang tải file IPA';
        else if (data.progress < 60) stepMessage = 'Đang giải nén IPA';
        else if (data.progress < 80) stepMessage = 'Đang ký IPA';
        else if (data.progress < 100) stepMessage = 'Đang tải IPA lên';
        else if (data.progress === 100) stepMessage = 'Hoàn tất tải ứng dụng';

        if (stepMessage) updateProgressSteps(stepMessage, 'success');
        setProgress(data.progress);

        if (data.status === 'complete') {
          setTimeout(() => {
            const appInfo = data.appInfo || {};
            $('appName').textContent = appInfo.name || 'Unknown';
            $('appAuthor').textContent = appInfo.artistName || appInfo.artist || 'Unknown';
            $('appVersion').textContent = appInfo.version || 'Unknown';
            $('appBundleId').textContent = appInfo.bundleId || 'Unknown';
            $('appDate').textContent = appInfo.releaseDate || 'Unknown';
            $('minimumOSVersion').textContent = appInfo.minimumOSVersion || 'Unknown';

            const encodedDownload = encodeURIComponent(data.downloadUrl || '#');
            const encodedInstall  = encodeURIComponent(data.installUrl || data.downloadUrl || '#');

            // ✅ MỞ TAB MỚI qua trang /go — DOWNLOAD
            elements.downloadLink.href = `/go?type=download&url=${encodedDownload}`;
            elements.downloadLink.setAttribute('target','_blank');
            elements.downloadLink.setAttribute('rel','noopener');

            // ✅ MỞ TAB MỚI qua trang /go — INSTALL
            if (data.installUrl) {
              elements.installLink.href = `/go?type=install&url=${encodedInstall}`;
              elements.installLink.classList.remove('cursor-not-allowed', 'bg-gray-400');
              elements.installLink.classList.add('bg-green-500', 'hover:bg-green-600');
              elements.installLink.setAttribute('target','_blank');
              elements.installLink.setAttribute('rel','noopener');
            }

            $('ipaFileSize').textContent = data.fileSizeMB ? `${data.fileSizeMB} MB` : 'Unknown';

            updateInstallButton(appInfo.minimumOSVersion, state.iosVersion, data.installUrl, data.downloadUrl);
            transition(elements.step3, elements.result);
            setLoading(false);

            if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');

            elements.progressSteps.classList.add('hidden'); elements.progressSteps.style.display = 'none';
            elements.progressBar.classList.add('hidden'); elements.progressBar.style.display = 'none';
            if (elements.progressWrap) { elements.progressWrap.classList.add('hidden'); elements.progressWrap.style.display = 'none'; }

            safeCloseEventSource();
          }, 500);
        } else if (data.status === 'error') {
          const friendly = mapServerErrorToMessage(data.code, data.error);
          showError(friendly);
          updateProgressSteps('Lỗi tải ứng dụng', 'error');
          setLoading(false);
          if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
          safeCloseEventSource();
        }
      } catch (error) {
        showError('Lỗi xử lý tiến trình.');
        updateProgressSteps('Lỗi xử lý tiến trình', 'error');
        setLoading(false);
        if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
        safeCloseEventSource();
      }
    };

    eventSource.onerror = () => {
      if (!state.progressHistory.includes(100)) {
        showError('Mất kết nối với server.');
        updateProgressSteps('Lỗi kết nối với server', 'error');
      }
      setLoading(false);
      if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
      safeCloseEventSource();
    };
  };

  /* ========== EVENTS ========== */

  if (elements.loginBtn) {
    elements.loginBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (isLoading) return;
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
        const response = await fetch('/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ APPLE_ID, PASSWORD })
        });

        let data = null;
        try { data = await response.json(); } catch { data = {}; }

        if (!response.ok) {
          showError((data && (data.error || data.message)) || 'Lỗi từ máy chủ.');
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
        console.error('Auth error:', error);
        showError('Không thể kết nối tới máy chủ.');
        setLoading(false);
      }
    });
  }

  if (elements.togglePassword) {
    elements.togglePassword.addEventListener('click', () => {
      const isPassword = elements.passwordInput.type === 'password';
      elements.passwordInput.type = isPassword ? 'text' : 'password';
      elements.togglePassword.innerHTML = isPassword ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
    });
  }

  if (elements.verifyBtn) {
    elements.verifyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
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
          body: JSON.stringify({ APPLE_ID: state.APPLE_ID, PASSWORD: state.PASSWORD, CODE, dsid: state.dsid })
        });
        let data = null;
        try { data = await response.json(); } catch { data = {}; }

        if (!response.ok) {
          showError((data && (data.error || data.message)) || 'Xác minh thất bại.');
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
  }

  if (elements.downloadBtn) {
    elements.downloadBtn.addEventListener('click', async (e) => {
      if (eventSource) safeCloseEventSource();
      e.preventDefault();
      if (isLoading) return;

      hideError();
      setLoading(true);
      clearProgressSteps();
      elements.progressSteps.classList.remove('hidden'); elements.progressSteps.style.display = 'block';
      elements.progressBar.classList.remove('hidden'); elements.progressBar.style.display = 'block';
      elements.progressBar.style.width = '0%';
      if (elements.progressWrap) { elements.progressWrap.classList.remove('hidden'); elements.progressWrap.style.display = 'block'; }

      if (elements.sessionNotice) elements.sessionNotice.classList.remove('hidden');

      const APPID = elements.appIdInput?.value.trim().match(/id(\d+)|^\d+$/)?.[1] || elements.appIdInput?.value.trim().match(/\d+/)?.[0] || '';
      const appVerId = elements.appVerInput?.value.trim() || '';
      state.iosVersion = deviceOSVersion;

      if (!APPID) {
        showError('Vui lòng nhập App ID hợp lệ.');
        updateProgressSteps('Lỗi: App ID không hợp lệ', 'error');
        setLoading(false);
        if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
        return;
      }

      if (state.requires2FA && !state.verified2FA) {
        showError('Vui lòng hoàn thành xác thực 2FA trước khi tải.');
        updateProgressSteps('Lỗi: Yêu cầu xác thực 2FA', 'error');
        setLoading(false);
        if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
        transition(elements.step3, elements.step2);
        return;
      }

      const bodyPayload = { APPLE_ID: state.APPLE_ID, PASSWORD: state.PASSWORD, CODE: state.CODE, APPID, appVerId, dsid: state.dsid };
      if (typeof grecaptcha !== 'undefined') {
        if (recaptchaWidgetId === null) { showError('reCAPTCHA chưa sẵn sàng. Vui lòng đợi 1-2 giây rồi thử lại.'); setLoading(false); if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden'); return; }
        const token = grecaptcha.getResponse(recaptchaWidgetId);
        if (!token) { showError('Vui lòng xác minh reCAPTCHA trước khi tải.'); setLoading(false); if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden'); return; }
        bodyPayload.recaptchaToken = token;
      }

      // ✅ [THÊM MỚI] Lấy Token bảo mật trước khi tải
      const secureToken = await getPurchaseToken();
      if (!secureToken) {
        showError('Không thể khởi tạo phiên làm việc bảo mật. Vui lòng tải lại trang.');
        updateProgressSteps('Lỗi: Không lấy được token bảo mật', 'error');
        setLoading(false);
        if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
        return;
      }
      // ✅ [KẾT THÚC THÊM MỚI]

      try {
        const response = await fetch('/download', {
          method: 'POST',
          // ✅ [SỬA ĐỔI] Thêm header token
          headers: { 
            'Content-Type': 'application/json',
            'x-purchase-token': secureToken 
          },
          body: JSON.stringify(bodyPayload)
        });

        const data = await response.json();

        if (data.require2FA) {
          handle2FARedirect(data);
          setLoading(false);
        } else if (data.success && data.requestId) {
          state.requestId = data.requestId;
          updateProgressSteps('Khởi tạo tiến trình tải', 'success');
          listenProgress(data.requestId);
        } else {
          const friendlyMessage = mapServerErrorToMessage(data.error, data.message);
          showError(friendlyMessage);
          
          updateProgressSteps('Lỗi tải ứng dụng', 'error');
          setLoading(false);
          if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
        }
      } catch (error) {
        console.error('Download error:', error);
        showError('Không thể kết nối tới máy chủ.');
        updateProgressSteps('Lỗi kết nối máy chủ', 'error');
        setLoading(false);
        if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
      }
    });
  }

  /* ====== (NEW) backToStep1 & downloadAnotherBtn ====== */

  // ← Quay lại (Step 2 → Step 1)
  if (elements.backToStep1) {
    elements.backToStep1.addEventListener('click', (e) => {
      e.preventDefault();
      hideError();

      // Reset trạng thái 2FA để nhập lại nếu cần
      state.requires2FA = false;
      state.verified2FA = false;
      state.CODE = '';
      if (elements.verificationCodeInput) elements.verificationCodeInput.value = '';

      // Dọn tiến trình + SSE + notice
      clearProgressSteps();
      safeCloseEventSource();
      if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
      if (elements.progressSteps) { elements.progressSteps.classList.add('hidden'); elements.progressSteps.style.display = 'none'; }
      if (elements.progressBar)  { elements.progressBar.style.width = '0%'; elements.progressBar.classList.add('hidden'); elements.progressBar.style.display = 'none'; }
      if (elements.progressWrap) { elements.progressWrap.classList.add('hidden'); elements.progressWrap.style.display = 'none'; }

      // Reset reCAPTCHA nếu có
      try { if (typeof grecaptcha !== 'undefined' && recaptchaWidgetId !== null) grecaptcha.reset(recaptchaWidgetId); } catch {}

      transition(elements.step2, elements.step1);
      setLoading(false);
    });
  }

  // Tải ứng dụng khác (Result → Step 3)
  if (elements.downloadAnotherBtn) {
    elements.downloadAnotherBtn.addEventListener('click', (e) => {
      e.preventDefault();
      hideError();
      safeCloseEventSource();

      // SỬA: Reset tất cả state quan trọng
      state.requestId = null;
      state.lastProgressStep = null;
      state.progressHistory = [];
      
      // Dọn input AppID/AppVer
      if (elements.appIdInput)  elements.appIdInput.value  = '';
      if (elements.appVerInput) elements.appVerInput.value = '';

      // Reset reCAPTCHA
      try { 
        if (typeof grecaptcha !== 'undefined' && recaptchaWidgetId !== null) {
          grecaptcha.reset(recaptchaWidgetId); 
        }
      } catch (e) {
        console.log('Recaptcha reset error:', e);
      }

      // Reset giao diện
      const compatNote = document.getElementById('compatNote');
      if (compatNote) {
        compatNote.className = 'mt-3 px-4 py-3 rounded-lg text-sm bg-yellow-50 text-yellow-700 border border-yellow-300 flex items-start hidden';
        compatNote.innerHTML = '<i class="fas fa-spinner fa-spin mr-2 mt-1"></i><span>Đang kiểm tra khả năng tương thích...</span>';
      }
      
      if (elements.installLink) {
        elements.installLink.href = '#';
        elements.installLink.className = 'flex-1 px-6 py-3 rounded-lg font-medium text-white bg-gray-400 cursor-not-allowed flex items-center justify-center';
        elements.installLink.innerHTML = '<i class="fas fa-mobile-alt mr-2"></i> Cài trực tiếp';
      }
      
      if (elements.downloadLink) elements.downloadLink.href = '#';

      // Dọn tiến trình
      clearProgressSteps();
      if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
      if (elements.progressSteps) { 
        elements.progressSteps.classList.add('hidden'); 
        elements.progressSteps.style.display = 'none'; 
      }
      if (elements.progressBar)  { 
        elements.progressBar.style.width = '0%'; 
        elements.progressBar.classList.add('hidden'); 
        elements.progressBar.style.display = 'none'; 
      }
      if (elements.progressWrap) { 
        elements.progressWrap.classList.add('hidden'); 
        elements.progressWrap.style.display = 'none'; 
      }

      transition(elements.result, elements.step3);
      setProgress(0);
      setLoading(false);
      
      // Focus vào input AppID
      setTimeout(() => {
        if (elements.appIdInput) elements.appIdInput.focus();
      }, 100);
    });
  }
});

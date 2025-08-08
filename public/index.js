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
    installLink.href = installUrl || downloadUrl || '#';
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

  const mapServerErrorToMessage = (error, message) => {
    const raw = `${error || ''} ${message || ''}`.trim();
    if (raw.includes('SERVER_BUSY')) return 'Máy chủ đang bận, vui lòng thử lại sau.';
    if (raw.startsWith('FILE_TOO_LARGE') || raw.includes('File IPA vượt quá giới hạn')) return 'Ứng dụng vượt quá dung lượng cho phép (300MB). Vui lòng chọn phiên bản nhỏ hơn.';
    if (raw.startsWith('OUT_OF_MEMORY') || raw.includes('Insufficient memory')) return 'Máy chủ không đủ RAM để xử lý. Vui lòng thử lại sau hoặc tải vào thời điểm ít người dùng.';
    if (raw === 'CANCELLED_BY_CLIENT') return 'Tiến trình đã bị hủy.';
    if (raw.startsWith('RECAPTCHA')) return 'Xác minh reCAPTCHA thất bại. Vui lòng thử lại.';
    return message || error || 'Đã xảy ra lỗi không xác định.';
  };

  /* ========== reCAPTCHA explicit render (không reset token ngoài ý muốn) ========== */
  let recaptchaWidgetId = null;
  let recaptchaSiteKey = null;

  async function loadSiteKeyOnce() {
    if (recaptchaSiteKey) return recaptchaSiteKey;
    try {
      const resp = await fetch('/recaptcha-sitekey', { cache: 'no-store' });
      if (resp.ok) {
        const json = await resp.json();
        recaptchaSiteKey = json?.siteKey || '';
      }
    } catch (e) {
      console.warn('Cannot fetch sitekey from server:', e);
    }
    if (!recaptchaSiteKey && elements.recaptchaContainer) {
      const dataAttr = elements.recaptchaContainer.getAttribute('data-sitekey');
      if (dataAttr) recaptchaSiteKey = dataAttr;
    }
    return recaptchaSiteKey;
  }

  function renderRecaptchaWhenReady() {
    if (!elements.recaptchaContainer) return;
    const tryRender = () => {
      if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
        try {
          if (recaptchaWidgetId === null) {
            recaptchaWidgetId = window.grecaptcha.render(elements.recaptchaContainer, { sitekey: recaptchaSiteKey });
            console.log('reCAPTCHA rendered, widgetId:', recaptchaWidgetId);
          }
        } catch (err) {
          console.error('grecaptcha.render error:', err);
        }
      } else {
        setTimeout(tryRender, 200);
      }
    };
    tryRender();
  }

  async function ensureRecaptchaOnStep3() {
    await loadSiteKeyOnce();
    if (!recaptchaSiteKey) {
      console.error('Missing reCAPTCHA siteKey. Provide via /recaptcha-sitekey or data-sitekey.');
      return;
    }
    renderRecaptchaWhenReady();
  }

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

            elements.downloadLink.href = `/go?type=download&url=${encodedDownload}`;
            elements.downloadLink.removeAttribute('download');
            elements.downloadLink.setAttribute('rel','noopener');

            if (data.installUrl) {
              elements.installLink.href = `/go?type=install&url=${encodedInstall}`;
              elements.installLink.classList.remove('cursor-not-allowed', 'bg-gray-400');
              elements.installLink.classList.add('bg-green-500', 'hover:bg-green-600');
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

  /* ========== EVENT HANDLERS ========== */

  if ($('backToStep1')) {
    $('backToStep1').addEventListener('click', () => transition(elements.step2, elements.step1));
  }

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
          await ensureRecaptchaOnStep3();
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
          await ensureRecaptchaOnStep3();
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

      // ⬇️ HIỆN 2 DÒNG THÔNG BÁO cùng lúc với tiến trình
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

      // Đảm bảo reCAPTCHA đã render
      if (typeof grecaptcha === 'undefined' || recaptchaWidgetId === null) {
        await ensureRecaptchaOnStep3();
        showError('Vui lòng xác minh reCAPTCHA trước khi tải.');
        setLoading(false);
        if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
        return;
      }

      const token = grecaptcha.getResponse(recaptchaWidgetId);
      if (!token) {
        showError('Vui lòng xác minh reCAPTCHA trước khi tải.');
        setLoading(false);
        if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
        return;
      }

      const bodyPayload = {
        APPLE_ID: state.APPLE_ID,
        PASSWORD: state.PASSWORD,
        CODE: state.CODE,
        APPID,
        appVerId,
        dsid: state.dsid,
        recaptchaToken: token
      };

      setProgress(3);

      try {
        const response = await fetch('/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload)
        });

        // reset reCAPTCHA sau khi gửi
        try { if (recaptchaWidgetId !== null) grecaptcha.reset(recaptchaWidgetId); } catch {}

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
          showError((data && (data.error || data.message)) || 'Tải ứng dụng thất bại.');
          updateProgressSteps('Lỗi tải ứng dụng', 'error');
          setLoading(false);
          if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
          return;
        }

        if (data.require2FA) {
          updateProgressSteps('Yêu cầu xác thực 2FA', 'pending');
          handle2FARedirect(data);
          setLoading(false);
          if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');
        } else if (data.success && data.requestId) {
          state.requestId = data.requestId;
          listenProgress(data.requestId);
        } else {
          showError('Tải ứng dụng thất bại.');
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

  if (elements.downloadAnotherBtn) {
    elements.downloadAnotherBtn.addEventListener('click', () => {
      state.requestId = null;
      clearProgressSteps();
      isLoading = false;

      elements.result.classList.add('fade-out');
      setTimeout(async () => {
        elements.result.classList.add('hidden');
        elements.result.style.display = 'none';
        elements.result.classList.remove('fade-out');

        elements.step3.classList.remove('hidden');
        elements.step3.style.display = 'block';
        elements.step3.classList.add('fade-in');
        setTimeout(() => { elements.step3.classList.remove('fade-in'); }, 300);

        elements.progressBar.style.width = '0%';
        elements.progressBar.classList.remove('hidden'); elements.progressBar.style.display = 'block';
        elements.progressSteps.classList.remove('hidden'); elements.progressSteps.style.display = 'block';
        if (elements.progressWrap) { elements.progressWrap.classList.remove('hidden'); elements.progressWrap.style.display = 'block'; }

        elements.appIdInput.value = '';
        elements.appVerInput.value = '';

        ['appName', 'appVersion', 'ipaFileSize', 'appDate', 'appAuthor', 'appBundleId', 'minimumOSVersion'].forEach(id => {
          const el = $(id);
          if (el) el.textContent = 'Unknown';
        });

        elements.installLink.href = '#';
        elements.installLink.className = 'px-6 py-3 rounded-lg font-medium text-white bg-gray-400 cursor-not-allowed flex items-center justify-center';
        elements.installLink.innerHTML = '<i class="fas fa-mobile-alt mr-2"></i> Cài trực tiếp';

        elements.downloadLink.href = '#';
        elements.downloadLink.removeAttribute('download');

        const compat = $('compatNote');
        if (compat) {
          compat.className = 'mt-3 px-4 py-3 rounded-lg text-sm bg-yellow-50 text-yellow-700 border border-yellow-300 flex items-start';
          compat.innerHTML = '<i class="fas fa-spinner fa-spin mr-2 mt-1"></i><span>Đang kiểm tra khả năng tương thích với thiết bị của bạn...</span>';
        }

        // ẨN 2 dòng thông báo khi chưa có tiến trình
        if (elements.sessionNotice) elements.sessionNotice.classList.add('hidden');

        safeCloseEventSource();
        await ensureRecaptchaOnStep3();
        elements.appIdInput?.focus();
      }, 300);
    });
  }
});
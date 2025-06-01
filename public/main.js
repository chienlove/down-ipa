document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  const resultBox = document.getElementById('result');
  const errorBox = document.getElementById('error');
  const errorMessage = document.getElementById('errorMessage');
  const verifyMessage = document.getElementById('verifyMessage');
  const progressBar = document.getElementById('progressBar');
  
  // Buttons
  const loginBtn = document.getElementById('loginBtn');
  const verifyBtn = document.getElementById('verifyBtn');
  const downloadBtn = document.getElementById('downloadBtn');

  // State
  let authData = {};
  let currentStep = 1;

  // Initialize buttons
  [loginBtn, verifyBtn, downloadBtn].forEach(btn => {
    btn.dataset.originalText = btn.textContent;
  });

  // Helper functions
  const setLoading = (button, state) => {
    if (state) {
      button.disabled = true;
      button.innerHTML = `
        <svg class="animate-spin mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        ${button.dataset.originalText}
      `;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText;
    }
  };

  const showError = (msg) => {
    errorMessage.textContent = msg;
    errorBox.classList.remove('hidden');
    errorBox.classList.add('animate__animated', 'animate__headShake');
    setTimeout(() => {
      errorBox.classList.remove('animate__headShake');
    }, 1000);
  };

  const hideError = () => {
    errorBox.classList.add('hidden');
  };

  const updateProgress = (step) => {
    const percentages = {1: '25%', 2: '60%', 3: '90%', 4: '100%'};
    progressBar.style.width = percentages[step];
    currentStep = step;
  };

  const transitionStep = (fromStep, toStep) => {
    fromStep.classList.add('animate__animated', 'animate__fadeOut');
    setTimeout(() => {
      fromStep.classList.add('hidden');
      fromStep.classList.remove('animate__fadeOut');
      
      toStep.classList.remove('hidden');
      toStep.classList.add('animate__animated', 'animate__fadeIn');
      
      setTimeout(() => {
        toStep.classList.remove('animate__fadeIn');
      }, 500);
    }, 300);
  };

  // Bước 1: Đăng nhập Apple ID
  loginBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    hideError();
    
    const APPLE_ID = document.getElementById('APPLE_ID').value.trim();
    const PASSWORD = document.getElementById('PASSWORD').value;

    if (!APPLE_ID || !PASSWORD) {
      showError('Vui lòng nhập đầy đủ Apple ID và mật khẩu');
      return;
    }

    setLoading(loginBtn, true);
    updateProgress(1);

    try {
      const res = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ APPLE_ID, PASSWORD })
      });

      const result = await res.json();

      if (result.require2FA) {
        verifyMessage.textContent = result.message || '🔐 Vui lòng nhập mã xác minh 2FA được gửi đến thiết bị của bạn';
        transitionStep(step1, step2);
        updateProgress(2);
        return;
      }

      if (result.success) {
        authData = { APPLE_ID, PASSWORD, CODE: '' };
        transitionStep(step1, step3);
        updateProgress(3);
        return;
      }

      showError(result.error || 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.');
    } catch (err) {
      console.error('Login error:', err);
      showError('Lỗi kết nối máy chủ. Vui lòng thử lại sau.');
    } finally {
      setLoading(loginBtn, false);
    }
  });

  // Bước 2: Xác thực 2FA
  verifyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    hideError();
    
    const CODE = document.getElementById('VERIFICATION_CODE').value.trim();
    
    if (!CODE || CODE.length !== 6) {
      showError('Vui lòng nhập mã xác minh 6 chữ số');
      return;
    }

    setLoading(verifyBtn, true);
    updateProgress(2);

    try {
      const res = await fetch('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...authData, CODE })
      });

      const result = await res.json();

      if (result.success) {
        authData.CODE = CODE;
        transitionStep(step2, step3);
        updateProgress(3);
        return;
      }

      showError(result.error || 'Mã xác minh không đúng. Vui lòng thử lại.');
    } catch (err) {
      console.error('Verify error:', err);
      showError('Lỗi xác thực. Vui lòng thử lại sau.');
    } finally {
      setLoading(verifyBtn, false);
    }
  });

  // Bước 3: Tải ứng dụng
  downloadBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    hideError();
    
    const APPID = extractAppId(document.getElementById('APPID').value.trim());
    const APP_VER_ID = document.getElementById('APP_VER_ID').value.trim();

    if (!APPID) {
      showError('Vui lòng nhập App ID hoặc URL hợp lệ');
      return;
    }

    setLoading(downloadBtn, true);
    updateProgress(3);

    try {
      const res = await fetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...authData, APPID, appVerId: APP_VER_ID })
      });

      const result = await res.json();

      if (result.require2FA) {
        // Trường hợp cần xác thực lại
        verifyMessage.textContent = result.message;
        transitionStep(step3, step2);
        updateProgress(2);
        return;
      }

      if (res.ok && result.downloadUrl) {
        displayResult(result);
        transitionStep(step3, resultBox);
        updateProgress(4);
        return;
      }

      showError(result.error || 'Tải ứng dụng thất bại. Vui lòng thử lại.');
    } catch (err) {
      console.error('Download error:', err);
      showError('Lỗi khi tải ứng dụng. Vui lòng thử lại sau.');
    } finally {
      setLoading(downloadBtn, false);
    }
  });

  // Helper functions
  function extractAppId(input) {
    if (/^\d+$/.test(input)) return input;
    const match = input.match(/id(\d+)/);
    return match ? match[1] : '';
  }

  function displayResult(result) {
    document.getElementById('appName').textContent = result.appInfo?.name || 'Không rõ';
    document.getElementById('appAuthor').textContent = result.appInfo?.artist || 'Không rõ';
    document.getElementById('appVersion').textContent = result.appInfo?.version || 'Không rõ';
    document.getElementById('appBundleId').textContent = result.appInfo?.bundleId || 'Không rõ';
    document.getElementById('appDate').textContent = result.appInfo?.releaseDate || 'Không rõ';
    
    const downloadLink = document.getElementById('downloadLink');
    downloadLink.href = result.downloadUrl;
    downloadLink.download = result.fileName || 'app.ipa';
  }
});
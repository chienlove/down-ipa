document.addEventListener('DOMContentLoaded', () => {
  const elements = {
    step1: document.getElementById('step1'),
    step2: document.getElementById('step2'),
    step3: document.getElementById('step3'),
    result: document.getElementById('result'),
    error: document.getElementById('error'),
    toast: document.getElementById('toast'),
    progress: document.getElementById('progressBar'),
    loginBtn: document.getElementById('loginBtn'),
    verifyBtn: document.getElementById('verifyBtn'),
    downloadBtn: document.getElementById('downloadBtn')
  };

  function setProgress(step) {
    const steps = { 1: 25, 2: 50, 3: 75, 4: 100 };
    elements.progress.style.width = steps[step] + '%';
  }

  function showToast(message, isError = false) {
    const toastText = elements.toast.querySelector('.text-sm');
    toastText.textContent = message;
    elements.toast.classList.remove('hidden');
    elements.toast.classList.toggle('bg-red-500', isError);
    elements.toast.classList.toggle('bg-green-500', !isError);
    setTimeout(() => elements.toast.classList.add('hidden'), 4000);
  }

  function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    elements.error.classList.remove('hidden');
    showToast(message, true);
  }

  function transition(from, to) {
    from.classList.add('hidden');
    to.classList.remove('hidden');
  }

  function setButtonLoading(btn, loading = true) {
    const icon = btn.querySelector('svg');
    const text = btn.querySelector('span');
    if (loading) {
      icon.classList.add('animate-spin');
      text.textContent = 'Đang xử lý...';
      btn.disabled = true;
    } else {
      icon.classList.remove('animate-spin');
      btn.disabled = false;
      if (btn === elements.loginBtn) text.textContent = 'Đăng nhập';
      if (btn === elements.verifyBtn) text.textContent = 'Tiếp tục';
      if (btn === elements.downloadBtn) text.textContent = 'Tải IPA';
    }
  }

  document.getElementById('togglePassword').addEventListener('click', () => {
    const pwd = document.getElementById('PASSWORD');
    const icon = document.getElementById('eyeIcon');
    pwd.type = pwd.type === 'password' ? 'text' : 'password';
    icon.setAttribute('d',
      pwd.type === 'password'
        ? 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7'
        : 'M4.318 4.318a9.956 9.956 0 0113.364 13.364'
    );
  });

  elements.loginBtn.addEventListener('click', async () => {
    const APPLE_ID = document.getElementById('APPLE_ID').value.trim();
    const PASSWORD = document.getElementById('PASSWORD').value.trim();
    if (!APPLE_ID || !PASSWORD) return showError('Vui lòng nhập Apple ID và mật khẩu');

    setButtonLoading(elements.loginBtn, true);
    elements.error.classList.add('hidden');

    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ APPLE_ID, PASSWORD })
      });
      const data = await res.json();
      if (!data.success) return showError(data.error || 'Đăng nhập thất bại');

      if (data.need2FA) {
        transition(elements.step1, elements.step2);
        setProgress(2);
      } else {
        transition(elements.step1, elements.step3);
        setProgress(3);
      }
    } catch (err) {
      showError('Lỗi mạng hoặc máy chủ.');
    } finally {
      setButtonLoading(elements.loginBtn, false);
    }
  });

  elements.verifyBtn.addEventListener('click', async () => {
    const CODE = document.getElementById('VERIFICATION_CODE').value.trim();
    const APPLE_ID = document.getElementById('APPLE_ID').value.trim();
    const PASSWORD = document.getElementById('PASSWORD').value.trim();
    if (!CODE) return showError('Vui lòng nhập mã xác minh');

    setButtonLoading(elements.verifyBtn, true);

    try {
      const res = await fetch('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ APPLE_ID, PASSWORD, CODE })
      });
      const data = await res.json();
      if (!data.success) return showError(data.error || 'Xác minh thất bại');

      transition(elements.step2, elements.step3);
      setProgress(3);
    } catch (err) {
      showError('Lỗi mạng hoặc máy chủ.');
    } finally {
      setButtonLoading(elements.verifyBtn, false);
    }
  });

  elements.downloadBtn.addEventListener('click', async () => {
    const APPID = document.getElementById('APPID').value.trim();
    const appVerId = document.getElementById('APP_VER_ID').value.trim();
    const APPLE_ID = document.getElementById('APPLE_ID').value.trim();
    const PASSWORD = document.getElementById('PASSWORD').value.trim();
    const CODE = document.getElementById('VERIFICATION_CODE').value.trim();
    if (!APPID) return showError('Vui lòng nhập App ID hoặc đường dẫn');

    setButtonLoading(elements.downloadBtn, true);
    elements.error.classList.add('hidden');

    try {
      const res = await fetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ APPID, appVerId, APPLE_ID, PASSWORD, CODE })
      });
      const data = await res.json();
      if (!data.success) return showError(data.error || 'Tải không thành công');

      // Hiển thị kết quả
      document.getElementById('appName').textContent = data.appInfo.name;
      document.getElementById('appAuthor').textContent = data.appInfo.artist;
      document.getElementById('appVersion').textContent = data.appInfo.version;
      document.getElementById('appBundleId').textContent = data.appInfo.bundleId;
      document.getElementById('appDate').textContent = data.appInfo.releaseDate;

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
    } catch (err) {
      showError('Lỗi khi tải ứng dụng.');
    } finally {
      setButtonLoading(elements.downloadBtn, false);
    }
  });
});
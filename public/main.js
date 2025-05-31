document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('download-form');
  const submitBtn = document.getElementById('submitBtn');
  const resultBox = document.getElementById('result');
  const errorBox = document.getElementById('error');
  const verifyBox = document.getElementById('verifyBox'); // ô thông báo mã 2FA

  const originalText = submitBtn.textContent;

  const setLoading = (state) => {
    if (state) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<svg class="animate-spin mr-2 h-5 w-5 inline text-white" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg> Đang xử lý...`;
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.add('hidden');
    resultBox.classList.add('hidden');
    verifyBox.classList.add('hidden');

    const APPID = extractAppId(form.APPID.value.trim());
    if (!APPID) {
      showError('❗ App ID không hợp lệ. Hãy nhập đúng ID hoặc URL App Store.');
      return;
    }

    const code = form.VERIFICATION_CODE.value.trim();

    const data = {
      APPLE_ID: form.APPLE_ID.value.trim(),
      PASSWORD: form.PASSWORD.value,
      APPID,
      CODE: code
    };

    setLoading(true);

    try {
      const res = await fetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await res.json();

      // ✅ Nếu yêu cầu mã xác minh
      if (result.require2FA) {
        verifyBox.textContent = result.message || '🔐 Apple yêu cầu mã xác minh 2FA. Vui lòng nhập mã ở ô bên dưới và nhấn Tải IPA lại.';
        verifyBox.classList.remove('hidden');
        return;
      }

      if (res.ok && result.downloadUrl) {
        displayResult(result);
        return;
      }

      if (result.error?.toLowerCase().includes('password')) {
        showError('❌ Sai mật khẩu hoặc mã xác minh không hợp lệ hoặc đã hết hạn.');
      } else {
        showError(result.error || '⚠️ Đã xảy ra lỗi không xác định.');
      }
    } catch (err) {
      console.error(err);
      showError('⚠️ Lỗi kết nối máy chủ. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  });

  function extractAppId(input) {
    if (/^\d+$/.test(input)) return input;
    const match = input.match(/id(\d+)/);
    return match ? match[1] : '';
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }

  function displayResult(result) {
    document.getElementById('appName').textContent = result.appInfo?.name || 'Không rõ';
    document.getElementById('appAuthor').textContent = result.appInfo?.artist || 'Không rõ';
    document.getElementById('appVersion').textContent = result.appInfo?.version || 'Không rõ';
    document.getElementById('appBundleId').textContent = result.appInfo?.bundleId || 'Không rõ';
    document.getElementById('appDate').textContent = result.appInfo?.releaseDate || 'Không rõ';

    const link = document.getElementById('downloadLink');
    link.href = result.downloadUrl;
    link.download = result.fileName || 'app.ipa';

    resultBox.classList.remove('hidden');
  }
});
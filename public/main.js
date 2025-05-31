document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('download-form');
  const submitBtn = document.getElementById('submitBtn');
  const resultBox = document.getElementById('result');
  const errorBox = document.getElementById('error');

  // Hiệu ứng loading nút
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

    const APPID = extractAppId(form.APPID.value.trim());
    if (!APPID) {
      showError('App ID không hợp lệ. Hãy nhập đúng ID hoặc URL App Store.');
      return;
    }

    const codeFromInput = form.VERIFICATION_CODE.value.trim();
    const storedCode = localStorage.getItem('2FA_CODE');
    const CODE = storedCode || codeFromInput;

    const data = {
      APPLE_ID: form.APPLE_ID.value.trim(),
      PASSWORD: form.PASSWORD.value,
      APPID,
      CODE
    };

    setLoading(true);

    try {
      const res = await fetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await res.json();

      // ✅ Ưu tiên xử lý yêu cầu mã 2FA
      if (result.require2FA) {
        const code = prompt(result.message || '🔐 Nhập mã xác minh 2FA đã gửi đến thiết bị Apple của bạn:');
        if (code) {
          localStorage.setItem('2FA_CODE', code);
          form.VERIFICATION_CODE.value = code;
          submitBtn.click();
        } else {
          showError('⚠️ Bạn cần nhập mã xác minh để tiếp tục.');
        }
        return;
      }

      // ✅ Thành công
      if (res.ok && result.downloadUrl) {
        // Xoá mã 2FA sau khi dùng xong
        localStorage.removeItem('2FA_CODE');
        displayResult(result);
        return;
      }

      // ❌ Lỗi khác
      if (result.error?.toLowerCase().includes('password')) {
        showError('❌ Sai mật khẩu hoặc mã xác minh 2FA không hợp lệ hoặc đã hết hạn.');
      } else {
        showError(result.error || 'Đã xảy ra lỗi không xác định.');
      }

    } catch (err) {
      console.error(err);
      showError('Lỗi kết nối máy chủ. Vui lòng thử lại sau.');
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
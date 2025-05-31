document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('download-form');
  const submitBtn = document.getElementById('submitBtn');
  const resultBox = document.getElementById('result');
  const errorBox = document.getElementById('error');

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

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Đang xử lý...';

    try {
      const res = await fetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await res.json();

      if (result.require2FA) {
        showError('Cần mã xác minh 2FA. Vui lòng kiểm tra thiết bị của bạn và nhập mã ở ô bên trên.');
        return;
      }

      if (res.ok && result.downloadUrl) {
        if (CODE && !storedCode) {
          localStorage.setItem('2FA_CODE', CODE); // lưu 2FA lần đầu
        }
        displayResult(result);
      } else {
        showError(result.error || 'Đã xảy ra lỗi khi tải IPA.');
      }
    } catch (err) {
      console.error(err);
      showError('Lỗi kết nối máy chủ. Vui lòng thử lại sau.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '📥 Tải IPA';
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
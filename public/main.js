document.getElementById('download-form').addEventListener('submit', async function (e) {
  e.preventDefault();

  const form = e.target;
  const status = document.getElementById('status');
  const submitBtn = document.getElementById('submitBtn');
  const submitText = document.getElementById('submitText');
  const spinner = document.getElementById('spinner');

  const data = {
    APPLE_ID: form.APPLE_ID.value,
    PASSWORD: form.PASSWORD.value,
    CODE: form.VERIFICATION_CODE.value,
    APPID: form.APPID.value,
    appVerId: form.appVerId.value
  };

  // Hiệu ứng loading
  submitBtn.disabled = true;
  spinner.classList.remove('hidden');
  submitText.textContent = "Đang xử lý...";
  status.textContent = "⏳ Gửi yêu cầu đến server...";

  try {
    const res = await fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await res.json();

    if (res.ok && result.downloadUrl) {
      status.textContent = "✅ Thành công! Đang chuyển hướng...";
      window.location.href = result.downloadUrl;
    } else {
      throw new Error(result.error || 'Không rõ nguyên nhân');
    }

  } catch (err) {
    console.error('Lỗi:', err);
    status.textContent = "❌ Tải thất bại: " + (err.message || 'Không rõ lỗi');
    alert('Tải thất bại: ' + (err.message || 'Không rõ lỗi'));
  } finally {
    spinner.classList.add('hidden');
    submitText.textContent = "Tải IPA";
    submitBtn.disabled = false;
  }
});
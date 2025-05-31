document.getElementById('download-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    APPLE_ID: form.APPLE_ID.value,
    PASSWORD: form.PASSWORD.value,
    CODE: form.VERIFICATION_CODE.value,
    APPID: form.APPID.value,
    appVerId: form.appVerId.value
  };

  try {
    const res = await fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await res.json();
    if (result.url) {
      window.location.href = result.url;
    } else {
      alert('Tải thất bại: ' + (result.error || 'Không rõ nguyên nhân'));
    }
  } catch (err) {
    alert('Lỗi kết nối server: ' + err.message);
  }
});
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('download-form');
  const submitBtn = document.getElementById('submitBtn');
  const submitText = document.getElementById('submitText');
  const spinner = document.getElementById('spinner');

  // 🔁 Điền lại nếu có LocalStorage
  ['APPLE_ID', 'APPID', 'appVerId'].forEach(key => {
    if (localStorage.getItem(key)) {
      form[key].value = localStorage.getItem(key);
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const formData = {
      APPLE_ID: form.APPLE_ID.value,
      PASSWORD: form.PASSWORD.value,
      CODE: form.VERIFICATION_CODE.value,
      APPID: form.APPID.value,
      appVerId: form.appVerId.value
    };

    localStorage.setItem('APPLE_ID', formData.APPLE_ID);
    localStorage.setItem('APPID', formData.APPID);
    localStorage.setItem('appVerId', formData.appVerId);

    // Bắt đầu loading
    submitBtn.disabled = true;
    spinner.classList.remove('hidden');
    submitText.textContent = "Đang xử lý...";

    const tryDownload = async (payload) => {
      const res = await fetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();

      if (res.ok && result.downloadUrl) {
        Swal.fire({
          icon: 'success',
          title: 'Tải thành công!',
          text: 'IPA đang được tải xuống...',
          timer: 2000,
          showConfirmButton: false
        });
        setTimeout(() => {
          window.location.href = result.downloadUrl;
        }, 1500);
        return;
      }

      if (result.require2FA) {
        const { value: code } = await Swal.fire({
          title: '🔐 Mã xác minh 2FA',
          input: 'text',
          inputLabel: result.message || 'Nhập mã 6 chữ số được gửi đến thiết bị Apple của bạn.',
          inputPlaceholder: '123456',
          inputAttributes: {
            maxlength: 6,
            autocapitalize: 'off',
            autocorrect: 'off'
          },
          confirmButtonText: 'Tiếp tục'
        });

        if (code) {
          await tryDownload({ ...payload, CODE: code });
        } else {
          Swal.fire('Đã hủy', 'Bạn chưa nhập mã xác minh.', 'info');
        }
        return;
      }

      const errMsg = result.error?.toLowerCase() || '';
      if (errMsg.includes('password') || errMsg.includes('incorrect')) {
        Swal.fire('Sai mật khẩu', 'Apple ID hoặc mật khẩu không đúng.', 'error');
      } else if (errMsg.includes('version')) {
        Swal.fire('ID phiên bản không hợp lệ', 'Để trống để tải bản mới nhất.', 'warning');
      } else if (errMsg.includes('not found') || errMsg.includes('app')) {
        Swal.fire('App ID không đúng', 'Ứng dụng không tồn tại hoặc chưa mua bằng tài khoản này.', 'warning');
      } else {
        Swal.fire('Lỗi không xác định', result.error || 'Đã xảy ra lỗi trong quá trình xử lý.', 'error');
      }
    };

    try {
      await tryDownload(formData);
    } catch (err) {
      console.error('❌ Client error:', err);
      Swal.fire('Lỗi kết nối', err.message || 'Không thể kết nối đến máy chủ.', 'error');
    } finally {
      submitBtn.disabled = false;
      spinner.classList.add('hidden');
      submitText.textContent = "Tải IPA";
    }
  });
});
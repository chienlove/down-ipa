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

      // ✅ Nếu server yêu cầu mã xác minh 2FA
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

      // ✅ Thành công → hiện liên kết tải
      if (res.ok && result.downloadUrl) {
        const fileName = result.fileName || 'Tập tin IPA';
        const appName = result.appInfo?.name || 'Ứng dụng';
        const version = result.appInfo?.version || 'phiên bản không rõ';

        Swal.fire({
          icon: 'success',
          title: '📦 IPA đã sẵn sàng!',
          html: `
            <p><strong>${appName}</strong> (${version})</p>
            <div class="mt-4 space-y-3">
              <a href="${result.downloadUrl}" download class="block bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition">
                📥 Nhấn để tải về
              </a>
              <button onclick="navigator.clipboard.writeText('${location.origin + result.downloadUrl}'); Swal.fire('✅ Đã sao chép!', '', 'success')" class="block w-full py-2 px-4 border border-gray-300 rounded hover:bg-gray-100">
                📋 Sao chép liên kết
              </button>
              <a href="${result.downloadUrl}" target="_blank" class="block text-blue-600 underline">🌐 Mở trong tab mới</a>
            </div>
          `,
          showConfirmButton: false
        });
        return;
      }

      // ❌ Lỗi – phân tích cụ thể
      const errMsg = result.error?.toLowerCase() || '';
      if (errMsg.includes('password') || errMsg.includes('incorrect')) {
        Swal.fire('Sai mật khẩu', 'Apple ID hoặc mật khẩu không đúng.', 'error');
      } else if (errMsg.includes('version')) {
        Swal.fire('ID phiên bản không hợp lệ', 'Để trống để tải bản mới nhất.', 'warning');
      } else if (errMsg.includes('not found') || errMsg.includes('app')) {
        Swal.fire('App ID không đúng', 'Ứng dụng không tồn tại hoặc bạn chưa từng tải nó.', 'warning');
      } else if (errMsg.includes('code') || errMsg.includes('2fa')) {
        Swal.fire('Mã xác minh không đúng', 'Vui lòng kiểm tra lại mã 2FA.', 'error');
      } else {
        Swal.fire('Lỗi không xác định', result.error || 'Đã xảy ra lỗi không rõ.', 'error');
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
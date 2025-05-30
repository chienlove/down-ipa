import { useState } from 'react';

export default function IPADownloader() {
  const [form, setForm] = useState({
    appleId: '',
    password: '',
    appId: ''
  });
  const [loading, setLoading] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const payload = {
        ...form,
        ...(requires2FA && { twoFactorCode, sessionId })
      };

      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      // Xử lý yêu cầu 2FA
      if (res.status === 202) {
        setRequires2FA(true);
        setSessionId(data.sessionId);
        setMessage(data.message);
        return;
      }

      // Xử lý lỗi
      if (!res.ok) {
        throw new Error(data.message || 'Yêu cầu thất bại');
      }

      // Xử lý download thành công
      if (res.headers.get('content-type')?.includes('application/octet-stream')) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${form.appId}.ipa`;
        a.click();
        setMessage('Tải xuống thành công!');
      }

    } catch (error) {
      console.error('Error:', error);
      setMessage(error.message || 'Đã xảy ra lỗi');
      
      // Reset trạng thái 2FA nếu lỗi không liên quan
      if (!error.message.includes('2FA')) {
        setRequires2FA(false);
        setTwoFactorCode('');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '500px', margin: '0 auto', padding: '20px' }}>
      <h1>Tải ứng dụng IPA</h1>
      
      <form onSubmit={handleSubmit} style={{ 
        background: '#f5f5f5', 
        padding: '20px', 
        borderRadius: '8px',
        marginBottom: '20px'
      }}>
        {!requires2FA ? (
          <>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Apple ID:</label>
              <input
                type="email"
                name="appleId"
                value={form.appleId}
                onChange={(e) => setForm({...form, appleId: e.target.value})}
                required
                style={{ width: '100%', padding: '8px' }}
              />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Mật khẩu:</label>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={(e) => setForm({...form, password: e.target.value})}
                required
                style={{ width: '100%', padding: '8px' }}
              />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Bundle ID:</label>
              <input
                name="appId"
                value={form.appId}
                onChange={(e) => setForm({...form, appId: e.target.value})}
                required
                style={{ width: '100%', padding: '8px' }}
              />
            </div>
          </>
        ) : (
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>Mã xác thực 2 yếu tố:</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={twoFactorCode}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '');
                setTwoFactorCode(value.slice(0, 6));
              }}
              placeholder="Nhập mã 6 số"
              required
              autoFocus
              style={{ 
                width: '100%', 
                padding: '8px',
                textAlign: 'center',
                letterSpacing: '3px'
              }}
            />
            <p style={{ fontSize: '0.8em', color: '#666', marginTop: '5px' }}>
              Mã đã được gửi đến thiết bị đáng tin cậy của bạn
            </p>
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading}
          style={{ 
            background: '#007AFF', 
            color: 'white', 
            border: 'none', 
            padding: '10px 15px',
            borderRadius: '4px',
            cursor: 'pointer',
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? 'Đang xử lý...' : requires2FA ? 'Xác nhận mã 2FA' : 'Tải về'}
        </button>

        {message && (
          <div style={{ 
            marginTop: '15px', 
            padding: '10px',
            background: message.includes('thành công') ? '#d4edda' : '#f8d7da',
            color: message.includes('thành công') ? '#155724' : '#721c24',
            borderRadius: '4px'
          }}>
            {message}
          </div>
        )}
      </form>

      <div style={{ background: '#fff3cd', padding: '15px', borderRadius: '4px' }}>
        <h3 style={{ marginTop: 0 }}>Lưu ý quan trọng:</h3>
        <ul style={{ marginBottom: 0 }}>
          <li>Chỉ tải được ứng dụng bạn đã mua/tải miễn phí trước đó</li>
          <li>Apple ID phải bật xác thực 2 yếu tố</li>
          <li>Với tài khoản không bật 2FA, hệ thống sẽ tự động xử lý</li>
        </ul>
      </div>
    </div>
  );
}
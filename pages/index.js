import { useState, useEffect } from 'react';

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
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    
    // Chỉ set countdown cho initial request, không set cho 2FA
    if (!requires2FA) {
      setCountdown(30);
    }

    try {
      const payload = {
        ...form,
        ...(requires2FA && { twoFactorCode, sessionId })
      };

      console.log('Sending request:', { ...payload, password: '[HIDDEN]' });

      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log('Response status:', res.status);
      console.log('Response headers:', Object.fromEntries(res.headers.entries()));

      // Xử lý file download
      if (res.ok && res.headers.get('content-type')?.includes('application/octet-stream')) {
        console.log('Downloading file...');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${form.appId}.ipa`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        setMessage('Tải xuống thành công!');
        resetForm();
        return;
      }

      // Xử lý JSON response
      const data = await res.json();
      console.log('Response data:', data);

      // Xử lý yêu cầu 2FA
      if (data.requiresTwoFactor) {
        console.log('2FA required, sessionId:', data.sessionId);
        setRequires2FA(true);
        setSessionId(data.sessionId);
        setMessage(data.message || 'Vui lòng nhập mã 2FA từ thiết bị của bạn');
        setCountdown(120); // 2 minutes for 2FA
        return;
      }

      // Xử lý lỗi
      if (!res.ok) {
        throw new Error(data.message || `HTTP ${res.status}: ${res.statusText}`);
      }

      // Fallback cho các trường hợp khác
      setMessage(data.message || 'Yêu cầu hoàn thành');

    } catch (error) {
      console.error('Request Error:', error);
      setMessage(error.message || 'Đã xảy ra lỗi kết nối');
      
      // Reset form nếu không phải lỗi 2FA
      if (!error.message?.includes('2FA') && !requires2FA) {
        resetForm();
      }
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setRequires2FA(false);
    setTwoFactorCode('');
    setSessionId('');
    setCountdown(0);
  };

  const handleReset = () => {
    setForm({ appleId: '', password: '', appId: '' });
    resetForm();
    setMessage('');
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
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Apple ID:
              </label>
              <input
                type="email"
                name="appleId"
                value={form.appleId}
                onChange={(e) => setForm({...form, appleId: e.target.value})}
                required
                disabled={loading}
                style={{ 
                  width: '100%', 
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ddd'
                }}
                placeholder="example@icloud.com"
              />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Mật khẩu:
              </label>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={(e) => setForm({...form, password: e.target.value})}
                required
                disabled={loading}
                style={{ 
                  width: '100%', 
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ddd'
                }}
                placeholder="Mật khẩu Apple ID"
              />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Bundle ID:
              </label>
              <input
                name="appId"
                value={form.appId}
                onChange={(e) => setForm({...form, appId: e.target.value})}
                required
                disabled={loading}
                style={{ 
                  width: '100%', 
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ddd'
                }}
                placeholder="com.example.app"
              />
              <small style={{ color: '#666', fontSize: '0.8em' }}>
                Ví dụ: com.apple.mobilecal
              </small>
            </div>
          </>
        ) : (
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Mã xác thực 2 yếu tố:
            </label>
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
              disabled={loading}
              style={{ 
                width: '100%', 
                padding: '12px',
                textAlign: 'center',
                letterSpacing: '3px',
                fontSize: '18px',
                borderRadius: '4px',
                border: '2px solid #007AFF'
              }}
            />
            <p style={{ fontSize: '0.8em', color: '#666', marginTop: '5px', textAlign: 'center' }}>
              Mã đã được gửi đến thiết bị đáng tin cậy của bạn
              {countdown > 0 && ` (${Math.floor(countdown / 60)}:${(countdown % 60).toString().padStart(2, '0')})`}
            </p>
            <button 
              type="button"
              onClick={handleReset}
              style={{
                background: 'transparent',
                color: '#007AFF',
                border: '1px solid #007AFF',
                padding: '5px 10px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8em',
                marginTop: '5px'
              }}
            >
              Đăng nhập lại
            </button>
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading || (countdown > 0 && !requires2FA)}
          style={{ 
            background: loading || (countdown > 0 && !requires2FA) ? '#ccc' : '#007AFF', 
            color: 'white', 
            border: 'none', 
            padding: '12px 20px',
            borderRadius: '4px',
            cursor: loading || (countdown > 0 && !requires2FA) ? 'not-allowed' : 'pointer',
            width: '100%',
            fontSize: '16px',
            fontWeight: 'bold'
          }}
        >
          {loading ? 'Đang xử lý...' : requires2FA ? 'Xác nhận mã 2FA' : 'Tải về'}
        </button>

        {message && (
          <div style={{ 
            marginTop: '15px', 
            padding: '12px',
            background: message.includes('thành công') ? '#d4edda' : 
                       message.includes('2FA') || message.includes('mã') ? '#d1ecf1' : '#f8d7da',
            color: message.includes('thành công') ? '#155724' : 
                   message.includes('2FA') || message.includes('mã') ? '#0c5460' : '#721c24',
            borderRadius: '4px',
            borderLeft: `4px solid ${message.includes('thành công') ? '#28a745' : 
                                   message.includes('2FA') || message.includes('mã') ? '#17a2b8' : '#dc3545'}`
          }}>
            {message}
          </div>
        )}
      </form>

      <div style={{ background: '#fff3cd', padding: '15px', borderRadius: '4px', fontSize: '0.9em' }}>
        <h3 style={{ marginTop: 0, color: '#856404' }}>Lưu ý quan trọng:</h3>
        <ul style={{ marginBottom: 0, color: '#856404' }}>
          <li>Đảm bảo Apple ID đã mua/tải ứng dụng trước đó</li>
          <li>Mã 2FA sẽ hết hạn sau 2 phút</li>
          <li>Với tài khoản không bật 2FA, hệ thống sẽ tự động xử lý</li>
          <li>Bundle ID có thể tìm thấy trên App Store Connect hoặc các trang web phân tích ứng dụng</li>
        </ul>
      </div>

      {/* Debug info in development */}
      {process.env.NODE_ENV === 'development' && (
        <div style={{ 
          marginTop: '20px', 
          padding: '10px', 
          background: '#f8f9fa', 
          borderRadius: '4px',
          fontSize: '0.8em',
          fontFamily: 'monospace'
        }}>
          <strong>Debug:</strong><br/>
          Loading: {loading.toString()}<br/>
          Requires2FA: {requires2FA.toString()}<br/>
          SessionId: {sessionId}<br/>
          Countdown: {countdown}
        </div>
      )}
    </div>
  );
}
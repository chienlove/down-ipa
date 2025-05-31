import { useState, useEffect } from 'react';

export default function IPADownloader() {
  const [form, setForm] = useState({
    appleId: '',
    password: '',
    appId: ''
  });
  const [loading, setLoading] = useState(false);
  const [twoFALoading, setTwoFALoading] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [message, setMessage] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isWaitingFor2FA, setIsWaitingFor2FA] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const resetForm = () => {
    setRequires2FA(false);
    setTwoFactorCode('');
    setSessionId('');
    setCountdown(0);
    setIsWaitingFor2FA(false);
  };

  const handleReset = () => {
    setForm({ appleId: '', password: '', appId: '' });
    resetForm();
    setMessage('');
  };

  const handleTwoFactorChange = (e) => {
    const value = e.target.value.replace(/\D/g, '');
    setTwoFactorCode(value.slice(0, 6));
    
    // Auto-submit when 6 digits are entered
    if (value.length === 6 && requires2FA) {
      setTwoFALoading(true);
      setTimeout(() => {
        handleSubmit(e);
      }, 300);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (requires2FA) {
      setTwoFALoading(true);
    } else {
      setLoading(true);
    }
    setMessage('');

    const payload = {
      ...form,
      ...(requires2FA ? { twoFactorCode, sessionId } : {})
    };

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000) // 2 minutes timeout
      });

      if (res.ok && res.headers.get('content-type')?.includes('application/octet-stream')) {
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

      const data = await res.json();

      if (data.requiresTwoFactor) {
        setRequires2FA(true);
        setSessionId(data.sessionId);
        setMessage(data.message || 'Tài khoản yêu cầu mã 2FA. Vui lòng nhập mã 6 số');
        setCountdown(120);
        setIsWaitingFor2FA(true);
        return;
      }

      if (!res.ok) {
        throw new Error(data.message || 'Lỗi không xác định');
      }

      setMessage(data.message || 'Hoàn tất yêu cầu');
      resetForm();

    } catch (error) {
      console.error('Request Error:', error);
      if (error.name === 'AbortError') {
        setMessage('Yêu cầu hết hạn. Vui lòng thử lại');
      } else {
        setMessage(error.message || 'Đã xảy ra lỗi kết nối');
      }
    } finally {
      setLoading(false);
      setTwoFALoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '500px', margin: '0 auto', padding: '20px' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '20px' }}>Tải ứng dụng IPA</h1>
      
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
                value={form.appleId}
                onChange={(e) => setForm({...form, appleId: e.target.value})}
                required
                disabled={loading}
                style={{ 
                  width: '100%', 
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  fontSize: '16px'
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
                value={form.password}
                onChange={(e) => setForm({...form, password: e.target.value})}
                required
                disabled={loading}
                style={{ 
                  width: '100%', 
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  fontSize: '16px'
                }}
                placeholder="Mật khẩu Apple ID"
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Bundle ID:
              </label>
              <input
                value={form.appId}
                onChange={(e) => setForm({...form, appId: e.target.value})}
                required
                disabled={loading}
                style={{ 
                  width: '100%', 
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  fontSize: '16px'
                }}
                placeholder="com.example.app"
              />
              <small style={{ color: '#666', fontSize: '0.8em' }}>
                Ví dụ: com.apple.mobilecal
              </small>
            </div>
          </>
        ) : (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
              Mã xác thực 2 yếu tố:
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={twoFactorCode}
              onChange={handleTwoFactorChange}
              placeholder="Nhập mã 6 số"
              required
              autoFocus
              disabled={twoFALoading}
              style={{ 
                width: '100%', 
                padding: '12px',
                textAlign: 'center',
                letterSpacing: '3px',
                fontSize: '18px',
                borderRadius: '4px',
                border: twoFactorCode.length === 6 ? '2px solid #28a745' : '2px solid #007AFF'
              }}
            />
            <p style={{ 
              fontSize: '0.9em', 
              color: '#666', 
              marginTop: '8px', 
              textAlign: 'center' 
            }}>
              Mã đã được gửi đến thiết bị đáng tin cậy
              {countdown > 0 && ` (${Math.floor(countdown / 60)}:${(countdown % 60).toString().padStart(2, '0')})`}
            </p>
            {isWaitingFor2FA && (
              <p style={{ 
                fontSize: '0.9em', 
                color: '#17a2b8', 
                marginTop: '8px', 
                textAlign: 'center',
                fontStyle: 'italic'
              }}>
                Đang chờ xác thực 2FA...
              </p>
            )}
            <div style={{ textAlign: 'center', marginTop: '10px' }}>
              <button 
                type="button"
                onClick={handleReset}
                style={{
                  background: 'transparent',
                  color: '#007AFF',
                  border: '1px solid #007AFF',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.9em'
                }}
              >
                Đăng nhập lại
              </button>
            </div>
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading || twoFALoading || (requires2FA && twoFactorCode.length !== 6)}
          style={{ 
            background: (loading || twoFALoading || (requires2FA && twoFactorCode.length !== 6)) ? '#ccc' : '#007AFF', 
            color: 'white', 
            border: 'none', 
            padding: '12px',
            borderRadius: '4px',
            cursor: (loading || twoFALoading || (requires2FA && twoFactorCode.length !== 6)) ? 'not-allowed' : 'pointer',
            width: '100%',
            fontSize: '16px',
            fontWeight: 'bold',
            transition: 'background 0.3s'
          }}
        >
          {twoFALoading ? 'Đang xác thực...' : 
           loading ? 'Đang xử lý...' : 
           requires2FA ? 'Xác nhận mã 2FA' : 'Tải về'}
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
                                  message.includes('2FA') || message.includes('mã') ? '#17a2b8' : '#dc3545'}`,
            fontSize: '0.9em'
          }}>
            {message}
          </div>
        )}
      </form>

      <div style={{ 
        background: '#fff3cd', 
        padding: '15px', 
        borderRadius: '4px',
        fontSize: '0.9em',
        borderLeft: '4px solid #ffc107'
      }}>
        <h3 style={{ marginTop: 0, color: '#856404' }}>Lưu ý quan trọng:</h3>
        <ul style={{ marginBottom: 0, color: '#856404', paddingLeft: '20px' }}>
          <li>Đảm bảo Apple ID đã mua ứng dụng trước đó</li>
          <li>Mã 2FA có hiệu lực trong 2 phút</li>
          <li>Nhập chính xác Bundle ID của ứng dụng</li>
          <li>Không chia sẻ thông tin tài khoản</li>
          <li>Mã 2FA sẽ tự động gửi khi nhập đủ 6 số</li>
        </ul>
      </div>
    </div>
  );
}
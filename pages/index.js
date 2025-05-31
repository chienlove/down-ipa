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

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');

    // Validate 2FA code length if required
    if (requires2FA && twoFactorCode.length !== 6) {
      setMessage('Mã xác thực phải đủ 6 chữ số');
      return;
    }

    // Validate Bundle ID format
    if (!requires2FA && !/^[a-zA-Z0-9.-]+\.[a-zA-Z0-9.-]+/.test(form.appId)) {
      setMessage('Bundle ID không hợp lệ (ví dụ: com.example.app)');
      return;
    }

    try {
      if (requires2FA) {
        setTwoFALoading(true);
      } else {
        setLoading(true);
      }

      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          ...(requires2FA && { 
            twoFactorCode,
            sessionId 
          })
        })
      });

      // Check if response is a file download
      const contentType = response.headers.get('content-type');
      
      if (response.ok && contentType?.includes('application/octet-stream')) {
        const blob = await response.blob();
        
        // Validate blob size
        if (blob.size === 0) {
          throw new Error('Tệp tải xuống rỗng');
        }
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${form.appId}.ipa`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        setMessage('Tải xuống thành công!');
        resetForm();
        return;
      }

      // Parse JSON response for errors or 2FA requests
      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        throw new Error('Phản hồi từ server không hợp lệ');
      }

      console.log('Response data:', data);

      if (data.requiresTwoFactor) {
        setRequires2FA(true);
        setSessionId(data.sessionId);
        setMessage(data.message);
        setCountdown(120);
        return;
      }

      if (!response.ok) {
        // Log debug info if available
        if (data.debug) {
          console.error('Debug info:', data.debug);
        }
        throw new Error(data.message || 'Lỗi không xác định');
      }

      setMessage(data.message || 'Thành công');
      resetForm();
    } catch (error) {
      console.error('Request error:', error);
      
      // Handle specific error types
      let errorMessage = error.message;
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMessage = 'Lỗi kết nối mạng, vui lòng kiểm tra internet';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Quá thời gian chờ, vui lòng thử lại';
      }
      
      setMessage(errorMessage);
    } finally {
      setLoading(false);
      setTwoFALoading(false);
    }
  };

  const resetForm = () => {
    setRequires2FA(false);
    setTwoFactorCode('');
    setSessionId('');
    setCountdown(0);
  };

  const handleTwoFactorChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setTwoFactorCode(value);
  };

  const handleCancel2FA = () => {
    resetForm();
    setMessage('');
  };

  return (
    <div style={{ 
      maxWidth: '500px', 
      margin: '0 auto', 
      padding: '20px',
      background: '#f5f5f5',
      borderRadius: '8px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h1 style={{ 
        textAlign: 'center', 
        marginBottom: '20px',
        color: '#333'
      }}>Tải ứng dụng IPA</h1>
      
      <form onSubmit={handleSubmit} style={{ 
        background: 'white', 
        padding: '20px', 
        borderRadius: '8px',
        marginBottom: '20px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        {!requires2FA ? (
          <>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ 
                display: 'block', 
                marginBottom: '5px', 
                fontWeight: 'bold',
                color: '#555'
              }}>
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
                  fontSize: '16px',
                  boxSizing: 'border-box'
                }}
                placeholder="example@icloud.com"
              />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ 
                display: 'block', 
                marginBottom: '5px', 
                fontWeight: 'bold',
                color: '#555'
              }}>
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
                  fontSize: '16px',
                  boxSizing: 'border-box'
                }}
                placeholder="Mật khẩu Apple ID"
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ 
                display: 'block', 
                marginBottom: '5px', 
                fontWeight: 'bold',
                color: '#555'
              }}>
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
                  fontSize: '16px',
                  boxSizing: 'border-box'
                }}
                placeholder="com.example.app"
              />
              <small style={{ 
                color: '#666', 
                fontSize: '0.8em',
                display: 'block',
                marginTop: '5px'
              }}>
                Ví dụ: com.apple.mobilecal, com.facebook.Facebook
              </small>
            </div>
          </>
        ) : (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '10px', 
              fontWeight: 'bold',
              color: '#555',
              textAlign: 'center'
            }}>
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
                border: twoFactorCode.length === 6 ? '2px solid #28a745' : '2px solid #007AFF',
                boxSizing: 'border-box'
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
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
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
              flex: 1,
              fontSize: '16px',
              fontWeight: 'bold',
              transition: 'background 0.3s'
            }}
          >
            {twoFALoading ? 'Đang xác thực...' : 
             loading ? 'Đang xử lý...' : 
             requires2FA ? 'Xác nhận mã 2FA' : 'Tải về'}
          </button>

          {requires2FA && (
            <button 
              type="button"
              onClick={handleCancel2FA}
              disabled={twoFALoading}
              style={{ 
                background: '#6c757d', 
                color: 'white', 
                border: 'none', 
                padding: '12px',
                borderRadius: '4px',
                cursor: twoFALoading ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                minWidth: '80px'
              }}
            >
              Hủy
            </button>
          )}
        </div>

        {message && (
          <div style={{ 
            marginTop: '15px', 
            padding: '12px',
            background: message.includes('thành công') ? '#d4edda' : 
                      message.includes('2FA') || message.includes('xác thực') ? '#d1ecf1' : '#f8d7da',
            color: message.includes('thành công') ? '#155724' : 
                  message.includes('2FA') || message.includes('xác thực') ? '#0c5460' : '#721c24',
            borderRadius: '4px',
            borderLeft: `4px solid ${message.includes('thành công') ? '#28a745' : 
                                  message.includes('2FA') || message.includes('xác thực') ? '#17a2b8' : '#dc3545'}`,
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
        <ul style={{ 
          marginBottom: 0, 
          color: '#856404', 
          paddingLeft: '20px',
          lineHeight: '1.5'
        }}>
          <li>Đảm bảo Apple ID đã mua ứng dụng trước đó</li>
          <li>Mã 2FA có hiệu lực trong 2 phút</li>
          <li>Nhập chính xác Bundle ID của ứng dụng</li>
          <li>Không chia sẻ thông tin tài khoản</li>
          <li>Quá trình tải có thể mất vài phút tùy kích thước ứng dụng</li>
        </ul>
      </div>
    </div>
  );
}
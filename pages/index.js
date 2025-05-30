import { useState } from 'react';

export default function Home() {
  const [form, setForm] = useState({ 
    appleId: '', 
    password: '', 
    appId: '',
    appVerId: ''
  });
  const [loading, setLoading] = useState(false);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [message, setMessage] = useState('');

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const payload = requiresTwoFactor 
        ? { ...form, twoFactorCode, sessionId }
        : form;

      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.status === 202) {
        // Requires 2FA
        const data = await res.json();
        setRequiresTwoFactor(true);
        setSessionId(data.sessionId);
        setMessage(data.message);
      } else if (res.ok) {
        // Success - download file
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${form.appId || 'app'}.ipa`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        setMessage('Tải xuống thành công!');
        setRequiresTwoFactor(false);
        setTwoFactorCode('');
        setSessionId('');
      } else {
        const error = await res.json();
        setMessage(`Lỗi: ${error.message || 'Không xác định'}`);
        if (!error.message?.includes('2FA') && !error.message?.includes('xác thực')) {
          setRequiresTwoFactor(false);
          setTwoFactorCode('');
          setSessionId('');
        }
      }
    } catch (error) {
      console.error('Request error:', error);
      setMessage('Lỗi kết nối. Vui lòng thử lại.');
    }

    setLoading(false);
  };

  const resetForm = () => {
    setRequiresTwoFactor(false);
    setTwoFactorCode('');
    setSessionId('');
    setMessage('');
    setForm({ appleId: '', password: '', appId: '', appVerId: '' });
  };

  return (
    <div style={{ 
      padding: '40px', 
      maxWidth: '600px', 
      margin: '0 auto',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h1 style={{ 
        textAlign: 'center', 
        color: '#333',
        marginBottom: '30px'
      }}>
        IPA Downloader
      </h1>
      
      <div style={{
        backgroundColor: '#f9f9f9',
        padding: '30px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
      }}>
        <form onSubmit={handleSubmit}>
          {!requiresTwoFactor ? (
            <>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Apple ID:
                </label>
                <input 
                  name="appleId" 
                  placeholder="your.email@example.com" 
                  value={form.appleId}
                  onChange={handleChange} 
                  required 
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Mật khẩu:
                </label>
                <input 
                  name="password" 
                  placeholder="Mật khẩu Apple ID" 
                  type="password" 
                  value={form.password}
                  onChange={handleChange} 
                  required 
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  Bundle ID:
                </label>
                <input 
                  name="appId" 
                  placeholder="com.example.app" 
                  value={form.appId}
                  onChange={handleChange} 
                  required 
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  App Version ID (tùy chọn):
                </label>
                <input 
                  name="appVerId" 
                  placeholder="Để trống để tải phiên bản mới nhất" 
                  value={form.appVerId}
                  onChange={handleChange}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </>
          ) : (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Mã xác thực 2 yếu tố:
              </label>
              <input 
                type="text" 
                placeholder="Nhập mã 6 số" 
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                required 
                maxLength="6"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '16px',
                  boxSizing: 'border-box',
                  textAlign: 'center',
                  letterSpacing: '2px'
                }}
              />
            </div>
          )}
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              type="submit" 
              disabled={loading}
              style={{
                flex: 1,
                padding: '12px 24px',
                backgroundColor: loading ? '#ccc' : '#007AFF',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.3s'
              }}
            >
              {loading ? 'Đang xử lý...' : (requiresTwoFactor ? 'Xác nhận' : 'Tải IPA')}
            </button>
            
            {requiresTwoFactor && (
              <button 
                type="button"
                onClick={resetForm}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '16px',
                  cursor: 'pointer'
                }}
              >
                Hủy
              </button>
            )}
          </div>
        </form>
        
        {message && (
          <div style={{
            marginTop: '20px',
            padding: '12px',
            borderRadius: '4px',
            backgroundColor: message.includes('Lỗi') ? '#f8d7da' : '#d4edda',
            color: message.includes('Lỗi') ? '#721c24' : '#155724',
            border: `1px solid ${message.includes('Lỗi') ? '#f5c6cb' : '#c3e6cb'}`
          }}>
            {message}
          </div>
        )}
      </div>
      
      <div style={{ 
        marginTop: '30px', 
        padding: '20px',
        backgroundColor: '#fff3cd',
        borderRadius: '4px',
        border: '1px solid #ffeaa7'
      }}>
        <h3 style={{ margin: '0 0 10px 0', color: '#856404' }}>Lưu ý:</h3>
        <ul style={{ margin: 0, color: '#856404' }}>
          <li>Chỉ có thể tải ứng dụng mà bạn đã mua hoặc tải miễn phí trước đó</li>
          <li>Cần bật xác thực 2 yếu tố (2FA) cho Apple ID</li>
          <li>Bundle ID có thể tìm thấy trên App Store hoặc các trang web tra cứu</li>
        </ul>
      </div>
    </div>
  );
}
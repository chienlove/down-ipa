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
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const payload = {
        appleId: form.appleId,
        password: form.password,
        appId: form.appId,
        appVerId: form.appVerId,
        ...(requiresTwoFactor && { 
          twoFactorCode,
          sessionId 
        })
      };

      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Xử lý response
      if (res.status === 202) {
        // Yêu cầu 2FA
        const data = await res.json();
        setRequiresTwoFactor(true);
        setSessionId(data.sessionId);
        setMessage(data.message);
      } else if (res.ok) {
        // Download thành công
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${form.appId}.ipa`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        setMessage('✅ Tải xuống thành công!');
        resetForm();
      } else {
        // Xử lý lỗi
        const error = await res.json();
        const errorMsg = error.message || 'Lỗi không xác định';
        
        setMessage(`❌ ${errorMsg}`);
        if (!errorMsg.includes('2FA')) {
          setRequiresTwoFactor(false);
          setTwoFactorCode('');
        }
      }
    } catch (error) {
      console.error('Request error:', error);
      setMessage('❌ Lỗi kết nối. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setRequiresTwoFactor(false);
    setTwoFactorCode('');
    setSessionId('');
    setMessage('');
  };

  return (
    <div className="container">
      <h1>IPA Downloader</h1>
      
      <div className="form-container">
        <form onSubmit={handleSubmit}>
          {!requiresTwoFactor ? (
            <>
              <div className="form-group">
                <label>Apple ID:</label>
                <input
                  type="email"
                  name="appleId"
                  placeholder="your@email.com"
                  value={form.appleId}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label>Mật khẩu:</label>
                <div className="password-input">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    placeholder="Mật khẩu Apple ID"
                    value={form.password}
                    onChange={handleChange}
                    required
                  />
                  <button
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Bundle ID:</label>
                <input
                  name="appId"
                  placeholder="com.example.app"
                  value={form.appId}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label>App Version ID (tùy chọn):</label>
                <input
                  name="appVerId"
                  placeholder="Để trống nếu không biết"
                  value={form.appVerId}
                  onChange={handleChange}
                />
              </div>
            </>
          ) : (
            <div className="form-group">
              <label>Mã xác thực 2 yếu tố:</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Nhập mã 6 số"
                value={twoFactorCode}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '');
                  setTwoFactorCode(value.slice(0, 6));
                }}
                required
                className="two-factor-input"
              />
              <p className="hint">Vui lòng kiểm tra thiết bị đáng tin cậy của bạn để lấy mã</p>
            </div>
          )}

          <div className="button-group">
            <button 
              type="submit" 
              disabled={loading}
              className={loading ? 'loading' : ''}
            >
              {loading ? (
                <span className="spinner"></span>
              ) : requiresTwoFactor ? (
                'Xác nhận mã 2FA'
              ) : (
                'Tải xuống IPA'
              )}
            </button>

            {requiresTwoFactor && (
              <button 
                type="button"
                onClick={resetForm}
                className="cancel-btn"
              >
                Hủy bỏ
              </button>
            )}
          </div>
        </form>

        {message && (
          <div className={`message ${message.includes('❌') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}
      </div>

      <div className="notes">
        <h3>Lưu ý quan trọng:</h3>
        <ul>
          <li>Chỉ tải được ứng dụng bạn đã mua hoặc từng tải miễn phí</li>
          <li>Apple ID phải bật xác thực 2 yếu tố (2FA)</li>
          <li>Không lưu trữ thông tin đăng nhập của bạn</li>
          <li>Bundle ID có thể tìm trên <a href="https://apps.apple.com" target="_blank">App Store</a></li>
        </ul>
      </div>

      <style jsx>{`
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 2rem;
          font-family: 'Segoe UI', sans-serif;
        }
        
        h1 {
          text-align: center;
          color: #333;
          margin-bottom: 2rem;
        }
        
        .form-container {
          background: #f8f9fa;
          padding: 2rem;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .form-group {
          margin-bottom: 1.5rem;
        }
        
        label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 600;
          color: #333;
        }
        
        input {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 1rem;
          box-sizing: border-box;
        }
        
        .password-input {
          position: relative;
        }
        
        .toggle-password {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          font-size: 1.2rem;
        }
        
        .two-factor-input {
          text-align: center;
          letter-spacing: 0.5rem;
          font-size: 1.2rem;
          font-family: monospace;
        }
        
        .hint {
          margin-top: 0.5rem;
          font-size: 0.9rem;
          color: #666;
        }
        
        .button-group {
          display: flex;
          gap: 1rem;
          margin-top: 1rem;
        }
        
        button[type="submit"] {
          flex: 1;
          padding: 0.75rem;
          background: #007AFF;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        button[type="submit"]:hover {
          background: #0062CC;
        }
        
        button[type="submit"].loading {
          background: #0062CC;
        }
        
        .cancel-btn {
          padding: 0.75rem 1.5rem;
          background: #6c757d;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          cursor: pointer;
        }
        
        .cancel-btn:hover {
          background: #5a6268;
        }
        
        .spinner {
          border: 3px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top: 3px solid white;
          width: 20px;
          height: 20px;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .message {
          margin-top: 1.5rem;
          padding: 1rem;
          border-radius: 4px;
        }
        
        .success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        
        .error {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }
        
        .notes {
          margin-top: 2rem;
          padding: 1.5rem;
          background: #fff3cd;
          border-radius: 4px;
          border: 1px solid #ffeaa7;
          color: #856404;
        }
        
        .notes h3 {
          margin-top: 0;
        }
        
        .notes ul {
          padding-left: 1.5rem;
          margin-bottom: 0;
        }
        
        .notes a {
          color: #0056b3;
          text-decoration: none;
        }
        
        .notes a:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
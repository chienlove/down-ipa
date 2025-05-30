import { useState } from 'react';

export default function IPADownloader() {
  const [form, setForm] = useState({
    appleId: '',
    password: '',
    appId: '',
    appVerId: ''
  });
  const [loading, setLoading] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [message, setMessage] = useState({ text: '', isError: false });
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ text: '', isError: false });

    try {
      const payload = {
        ...form,
        ...(requires2FA && { twoFactorCode, sessionId })
      };

      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Handle 2FA requirement
      if (response.status === 202) {
        const data = await response.json();
        setRequires2FA(true);
        setSessionId(data.sessionId);
        setMessage({ 
          text: data.message || 'Vui lòng nhập mã xác thực 2 yếu tố', 
          isError: false 
        });
        return;
      }

      // Handle errors
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Yêu cầu thất bại');
      }

      // Handle successful download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${form.appId}.ipa`;
      a.click();
      
      setMessage({ 
        text: 'Tải xuống thành công!', 
        isError: false 
      });
      resetForm();

    } catch (error) {
      console.error('Error:', error);
      setMessage({ 
        text: error.message || 'Đã xảy ra lỗi', 
        isError: true 
      });
      
      // Reset 2FA state if error is not 2FA related
      if (!error.message.includes('2FA') && !error.message.includes('xác thực')) {
        setRequires2FA(false);
        setTwoFactorCode('');
      }
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setRequires2FA(false);
    setTwoFactorCode('');
    setSessionId('');
    setForm({ appleId: '', password: '', appId: '', appVerId: '' });
  };

  return (
    <div className="container">
      <h1>IPA Downloader</h1>
      
      <div className="card">
        <form onSubmit={handleSubmit}>
          {!requires2FA ? (
            <>
              <div className="form-group">
                <label htmlFor="appleId">Apple ID</label>
                <input
                  id="appleId"
                  type="email"
                  name="appleId"
                  value={form.appleId}
                  onChange={handleChange}
                  placeholder="email@example.com"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Mật khẩu</label>
                <div className="password-input">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    placeholder="Mật khẩu Apple ID"
                    required
                  />
                  <button
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="appId">Bundle ID</label>
                <input
                  id="appId"
                  type="text"
                  name="appId"
                  value={form.appId}
                  onChange={handleChange}
                  placeholder="com.example.app"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="appVerId">App Version ID (tùy chọn)</label>
                <input
                  id="appVerId"
                  type="text"
                  name="appVerId"
                  value={form.appVerId}
                  onChange={handleChange}
                  placeholder="Để trống cho phiên bản mới nhất"
                />
              </div>
            </>
          ) : (
            <div className="form-group">
              <label htmlFor="twoFactorCode">Mã xác thực 2 yếu tố</label>
              <input
                id="twoFactorCode"
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
              />
              <p className="hint">Kiểm tra thiết bị đáng tin cậy của bạn để lấy mã</p>
            </div>
          )}

          <div className="button-group">
            <button
              type="submit"
              disabled={loading}
              className={loading ? 'loading' : ''}
            >
              {loading ? (
                <span className="spinner" aria-hidden="true"></span>
              ) : requires2FA ? (
                'Xác nhận mã 2FA'
              ) : (
                'Tải xuống IPA'
              )}
            </button>

            {requires2FA && (
              <button
                type="button"
                onClick={resetForm}
                className="secondary"
                disabled={loading}
              >
                Hủy bỏ
              </button>
            )}
          </div>

          {message.text && (
            <div className={`message ${message.isError ? 'error' : 'success'}`}>
              {message.text}
            </div>
          )}
        </form>
      </div>

      <div className="notice">
        <h3>Lưu ý quan trọng</h3>
        <ul>
          <li>Chỉ tải được ứng dụng bạn đã mua hoặc từng tải miễn phí</li>
          <li>Apple ID phải bật xác thực 2 yếu tố (2FA)</li>
          <li>Không lưu trữ thông tin đăng nhập của bạn</li>
          <li>Bundle ID có thể tìm trên <a href="https://apps.apple.com" target="_blank" rel="noopener noreferrer">App Store</a></li>
        </ul>
      </div>

      <style jsx>{`
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 2rem;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }
        
        h1 {
          text-align: center;
          color: #333;
          margin-bottom: 2rem;
        }
        
        .card {
          background: #fff;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          padding: 2rem;
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
          padding: 0;
        }
        
        .hint {
          margin-top: 0.5rem;
          font-size: 0.875rem;
          color: #666;
        }
        
        .button-group {
          display: flex;
          gap: 1rem;
          margin-top: 1rem;
        }
        
        button {
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
        
        button:hover {
          background: #0062CC;
        }
        
        button.loading {
          background: #0062CC;
        }
        
        button.secondary {
          background: #6c757d;
          flex: 0 1 auto;
          padding: 0.75rem 1.5rem;
        }
        
        button.secondary:hover {
          background: #5a6268;
        }
        
        button:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        
        .spinner {
          border: 2px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top: 2px solid white;
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
        
        .notice {
          margin-top: 2rem;
          padding: 1.5rem;
          background: #fff3cd;
          border-radius: 4px;
          color: #856404;
        }
        
        .notice h3 {
          margin-top: 0;
          margin-bottom: 1rem;
        }
        
        .notice ul {
          padding-left: 1.5rem;
          margin: 0;
        }
        
        .notice a {
          color: #0056b3;
          text-decoration: none;
        }
        
        .notice a:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
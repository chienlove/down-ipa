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

  const resetForm = () => {
    setForm({ appleId: '', password: '', appId: '' });
    setRequires2FA(false);
    setTwoFactorCode('');
    setSessionId('');
    setCountdown(0);
    setMessage('');
  };

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

      const requestBody = {
        ...form,
        ...(requires2FA && { 
          twoFactorCode,
          sessionId 
        })
      };

      console.log('Sending request:', {
        ...requestBody,
        password: '[HIDDEN]',
        twoFactorCode: twoFactorCode ? '[HIDDEN]' : undefined
      });

      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      const contentType = response.headers.get('content-type') || '';
      console.log('Content type:', contentType);

      // Handle file download response
      if (response.ok && contentType.includes('application/octet-stream')) {
        const blob = await response.blob();
        
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

      // Handle JSON response
      if (contentType.includes('application/json')) {
        const data = await response.json();
        console.log('Parsed JSON data:', data);

        // Handle 2FA requirement (only for successful responses)
        if (response.ok && data.requiresTwoFactor) {
          setRequires2FA(true);
          setSessionId(data.sessionId);
          setMessage(data.message);
          setCountdown(120);
          return;
        }

        // Handle error responses (status 4xx, 5xx OR has error field)
        if (!response.ok || data.error) {
          if (data.debug) {
            console.error('Debug info:', data.debug);
          }
          
          // Specific error handling based on error type
          switch (data.error) {
            case 'AUTH_FAILED':
              if (requires2FA) {
                setMessage('Mã 2FA không đúng hoặc đã hết hạn. Vui lòng thử lại.');
                setTwoFactorCode(''); // Clear 2FA code for retry
              } else {
                setMessage('Sai Apple ID hoặc mật khẩu. Vui lòng kiểm tra lại.');
              }
              break;
            case 'SESSION_EXPIRED':
              setMessage('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
              resetForm();
              break;
            case 'APP_NOT_FOUND':
              setMessage('Không tìm thấy ứng dụng hoặc bạn chưa mua ứng dụng này.');
              break;
            case 'TIMEOUT':
              setMessage('Quá thời gian chờ. Vui lòng thử lại.');
              break;
            case 'INVALID_2FA_CODE':
              setMessage('Mã 2FA không hợp lệ. Vui lòng nhập lại.');
              setTwoFactorCode('');
              break;
            case 'INVALID_BUNDLE_ID':
              setMessage('Bundle ID không hợp lệ. Vui lòng kiểm tra định dạng.');
              break;
            case 'MISSING_FIELDS':
              setMessage('Vui lòng nhập đầy đủ thông tin.');
              break;
            case 'SERVER_ERROR':
            default:
              setMessage(data.message || 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.');
              console.error('Server error details:', data);
          }
          return;
        }

        // Handle other successful JSON responses
        if (data.message) {
          setMessage(data.message);
        }
        return;
      }

      // Handle non-JSON responses
      const responseText = await response.text();
      console.log('Non-JSON response:', responseText.substring(0, 500));
      
      if (!response.ok) {
        const errorMatch = responseText.match(/<title>(.*?)<\/title>/i);
        const errorTitle = errorMatch ? errorMatch[1] : `HTTP ${response.status}`;
        throw new Error(`Lỗi server: ${errorTitle}`);
      }

      throw new Error('Server trả về định dạng không mong đợi');

    } catch (error) {
      console.error('Request error:', error);
      
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        setMessage('Lỗi kết nối mạng, vui lòng kiểm tra kết nối internet');
      } else {
        setMessage(error.message || 'Đã xảy ra lỗi không xác định');
      }
    } finally {
      setLoading(false);
      setTwoFALoading(false);
    }
  };

  return (
    <>
      <style jsx global>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%);
          min-height: 100vh;
        }
        
        .container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 3rem 1rem;
        }
        
        .card {
          background: white;
          border-radius: 0.5rem;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
          padding: 1.5rem;
          width: 100%;
          max-width: 28rem;
        }
        
        .header {
          text-align: center;
          margin-bottom: 2rem;
        }
        
        .title {
          font-size: 1.5rem;
          font-weight: bold;
          color: #1f2937;
          margin-bottom: 0.5rem;
        }
        
        .subtitle {
          color: #6b7280;
        }
        
        .form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        
        .form-group {
          display: flex;
          flex-direction: column;
        }
        
        .label {
          display: block;
          font-size: 0.875rem;
          font-weight: 500;
          color: #374151;
          margin-bottom: 0.25rem;
        }
        
        .input {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #d1d5db;
          border-radius: 0.375rem;
          font-size: 1rem;
          transition: all 0.2s;
        }
        
        .input:focus {
          outline: none;
          ring: 2px solid #3b82f6;
          border-color: #3b82f6;
        }
        
        .input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .input-2fa {
          text-align: center;
          font-size: 1.125rem;
          letter-spacing: 0.1em;
        }
        
        .button {
          width: 100%;
          background-color: #2563eb;
          color: white;
          padding: 0.75rem 1rem;
          border: none;
          border-radius: 0.375rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
        
        .button:hover:not(:disabled) {
          background-color: #1d4ed8;
        }
        
        .button:focus {
          outline: none;
          ring: 2px solid #3b82f6;
        }
        
        .button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .button-secondary {
          background-color: #6b7280;
        }
        
        .button-secondary:hover:not(:disabled) {
          background-color: #4b5563;
        }
        
        .spinner {
          animation: spin 1s linear infinite;
          width: 1.25rem;
          height: 1.25rem;
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        .message {
          margin-top: 1rem;
          padding: 0.75rem;
          border-radius: 0.375rem;
          font-size: 0.875rem;
        }
        
        .message-success {
          background-color: #dcfce7;
          color: #166534;
        }
        
        .message-info {
          background-color: #dbeafe;
          color: #1e40af;
        }
        
        .message-error {
          background-color: #fee2e2;
          color: #dc2626;
        }
      `}</style>
      
      <div className="container">
        <div className="card">
          <div className="header">
            <h1 className="title">IPA Downloader</h1>
            <p className="subtitle">Tải xuống file IPA từ App Store</p>
          </div>

          <form onSubmit={handleSubmit} className="form">
            {!requires2FA ? (
              <>
                <div className="form-group">
                  <label className="label">Apple ID</label>
                  <input
                    type="email"
                    value={form.appleId}
                    onChange={(e) => setForm({...form, appleId: e.target.value})}
                    className="input"
                    required
                    disabled={loading}
                  />
                </div>

                <div className="form-group">
                  <label className="label">Mật khẩu</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({...form, password: e.target.value})}
                    className="input"
                    required
                    disabled={loading}
                  />
                </div>

                <div className="form-group">
                  <label className="label">Bundle ID</label>
                  <input
                    type="text"
                    value={form.appId}
                    onChange={(e) => setForm({...form, appId: e.target.value})}
                    placeholder="com.example.app"
                    className="input"
                    required
                    disabled={loading}
                  />
                </div>
              </>
            ) : (
              <div className="form-group">
                <label className="label">
                  Mã xác thực 2FA {countdown > 0 && `(${countdown}s)`}
                </label>
                <input
                  type="text"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="input input-2fa"
                  maxLength={6}
                  disabled={twoFALoading}
                  autoFocus
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading || twoFALoading || (requires2FA && twoFactorCode.length !== 6)}
              className="button"
            >
              {loading || twoFALoading ? (
                <>
                  <svg className="spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Đang xử lý...
                </>
              ) : requires2FA ? (
                'Xác thực 2FA'
              ) : (
                'Tải xuống'
              )}
            </button>

            {requires2FA && (
              <button
                type="button"
                onClick={resetForm}
                className="button button-secondary"
              >
                Quay lại
              </button>
            )}
          </form>

          {message && (
            <div className={`message ${
              message.includes('thành công') 
                ? 'message-success' 
                : message.includes('Vui lòng nhập mã')
                  ? 'message-info'
                  : 'message-error'
            }`}>
              {message}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

export default function Home() {
  const [formData, setFormData] = useState({
    appleId: '',
    password: '',
    appId: '',
    appVerId: '',
    twoFactorCode: ''
  });
  const [show2FA, setShow2FA] = useState(false);
  const [message, setMessage] = useState({ type: '', content: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const twoFactorRef = useRef(null);

  // Tự động focus vào trường 2FA
  useEffect(() => {
    if (show2FA && twoFactorRef.current) {
      twoFactorRef.current.focus();
    }
  }, [show2FA]);

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage({ type: '', content: '' });

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          appVerId: formData.appVerId || undefined,
          twoFactorCode: show2FA ? formData.twoFactorCode : undefined
        })
      });

      const data = await response.json();

      if (response.ok) {
        // Tải file IPA thành công
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${formData.appId}.ipa`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        
        setMessage({ type: 'success', content: 'Tải xuống thành công!' });
        setShow2FA(false);
        setFormData(prev => ({ ...prev, twoFactorCode: '' }));
      } else {
        if (data.error === '2FA_REQUIRED') {
          setShow2FA(true);
          setMessage({ 
            type: 'info', 
            content: data.message || 'Vui lòng nhập mã xác thực 2FA' 
          });
          setCountdown(30); // Đếm ngược 30s
        } else {
          setMessage({ 
            type: 'error', 
            content: data.message || 'Đã xảy ra lỗi' 
          });
        }
      }
    } catch (error) {
      setMessage({ 
        type: 'error', 
        content: error.message || 'Lỗi kết nối' 
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Hiệu ứng đếm ngược
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  return (
    <div className="container">
      <Head>
        <title>Tải IPA từ App Store</title>
        <meta name="description" content="Công cụ tải xuống file IPA" />
      </Head>

      <h1>Tải xuống IPA</h1>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Apple ID</label>
          <input
            type="text"
            id="appleId"
            value={formData.appleId}
            onChange={handleChange}
            required
            disabled={isLoading}
          />
        </div>

        <div className="form-group">
          <label>Mật khẩu</label>
          <input
            type="password"
            id="password"
            value={formData.password}
            onChange={handleChange}
            required
            disabled={isLoading}
          />
        </div>

        <div className="form-group">
          <label>Bundle ID</label>
          <input
            type="text"
            id="appId"
            value={formData.appId}
            onChange={handleChange}
            required
            disabled={isLoading}
            placeholder="com.example.app"
          />
        </div>

        <div className="form-group">
          <label>Version ID (tùy chọn)</label>
          <input
            type="text"
            id="appVerId"
            value={formData.appVerId}
            onChange={handleChange}
            disabled={isLoading}
          />
        </div>

        {show2FA && (
          <div className="form-group highlight">
            <label>Mã xác thực 2FA</label>
            <input
              type="text"
              id="twoFactorCode"
              ref={twoFactorRef}
              value={formData.twoFactorCode}
              onChange={handleChange}
              required
              disabled={isLoading}
              maxLength={6}
              pattern="\d{6}"
              placeholder="Nhập 6 chữ số"
            />
            {countdown > 0 && (
              <div className="countdown">Mã mới sau: {countdown}s</div>
            )}
          </div>
        )}

        <button type="submit" disabled={isLoading}>
          {isLoading ? (
            <>
              <span className="spinner"></span>
              {show2FA ? 'Đang xác thực...' : 'Đang đăng nhập...'}
            </>
          ) : 'Tải xuống'}
        </button>

        {message.content && (
          <div className={`message ${message.type}`}>
            {message.content}
          </div>
        )}
      </form>

      <style jsx>{`
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 2rem;
        }
        h1 {
          text-align: center;
          margin-bottom: 2rem;
        }
        .form-group {
          margin-bottom: 1.5rem;
        }
        label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
        }
        input {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 1rem;
        }
        .highlight input {
          border-color: #0070f3;
          background-color: #f5f9ff;
        }
        .countdown {
          font-size: 0.8rem;
          color: #666;
          margin-top: 0.25rem;
        }
        button {
          width: 100%;
          padding: 1rem;
          background-color: #0070f3;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
        button:disabled {
          background-color: #ccc;
          cursor: not-allowed;
        }
        .spinner {
          display: inline-block;
          width: 1rem;
          height: 1rem;
          border: 2px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .message {
          margin-top: 1rem;
          padding: 1rem;
          border-radius: 4px;
        }
        .message.success {
          background-color: #e6ffed;
          color: #1a7f37;
        }
        .message.error {
          background-color: #ffebee;
          color: #d32f2f;
        }
        .message.info {
          background-color: #e3f2fd;
          color: #1976d2;
        }
      `}</style>
    </div>
  );
}
import { useState } from 'react';
import Head from 'next/head';

export default function Home() {
  const [appleId, setAppleId] = useState('');
  const [password, setPassword] = useState('');
  const [appId, setAppId] = useState('');
  const [appVerId, setAppVerId] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setIsAuthLoading(true);
    setMessage({ text: '', type: '' });

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appleId,
          password,
          appId,
          appVerId,
          verificationCode: showMfa ? verificationCode : undefined,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        // Tạo link tải file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${appId}.ipa`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        
        setMessage({ 
          text: 'Tải xuống thành công!', 
          type: 'success' 
        });
        setShowMfa(false);
        setVerificationCode('');
      } else {
        if (result.error === '2FA required') {
          setShowMfa(true);
          setMessage({ 
            text: result.details, 
            type: 'info' 
          });
          // Focus vào trường nhập mã 2FA
          setTimeout(() => {
            document.getElementById('verificationCode')?.focus();
          }, 100);
        } else {
          setMessage({ 
            text: result.details || result.error || 'Lỗi khi tải xuống', 
            type: 'error' 
          });
        }
      }
    } catch (error) {
      setMessage({ 
        text: error.message || 'Lỗi kết nối đến server', 
        type: 'error' 
      });
    } finally {
      setIsLoading(false);
      setIsAuthLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Tải xuống IPA từ App Store</title>
        <meta name="description" content="Công cụ tải xuống file IPA từ App Store" />
      </Head>

      <div className="container">
        <h1>Tải xuống IPA</h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="appleId">Apple ID</label>
            <input
              type="text"
              id="appleId"
              value={appleId}
              onChange={(e) => setAppleId(e.target.value)}
              required
              disabled={isLoading}
              placeholder="email@example.com"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Mật khẩu</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
              placeholder="Mật khẩu Apple ID"
            />
          </div>

          <div className="form-group">
            <label htmlFor="appId">App Bundle ID</label>
            <input
              type="text"
              id="appId"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              required
              disabled={isLoading}
              placeholder="com.example.app"
            />
          </div>

          <div className="form-group">
            <label htmlFor="appVerId">App Version ID</label>
            <input
              type="text"
              id="appVerId"
              value={appVerId}
              onChange={(e) => setAppVerId(e.target.value)}
              required
              disabled={isLoading}
              placeholder="1234567890"
            />
          </div>

          {showMfa && (
            <div className="form-group highlight">
              <label htmlFor="verificationCode">Mã xác thực 2FA</label>
              <input
                type="text"
                id="verificationCode"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                required
                disabled={isLoading}
                placeholder="Nhập 6 chữ số từ thiết bị Apple"
                maxLength="6"
                pattern="\d{6}"
              />
              <small className="hint">Mã 6 số gửi đến thiết bị Apple của bạn</small>
            </div>
          )}

          <button type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                {isAuthLoading ? 'Đang xác thực...' : 'Đang tải xuống...'}
                <span className="spinner"></span>
              </>
            ) : 'Tải xuống'}
          </button>
        </form>

        {message.text && (
          <div className={`message ${message.type}`}>
            {message.text}
          </div>
        )}
      </div>

      <style jsx>{`
        .container {
          max-width: 600px;
          margin: 2rem auto;
          padding: 2rem;
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
          text-align: center;
          margin-bottom: 2rem;
          color: #333;
        }
        .form-group {
          margin-bottom: 1.5rem;
        }
        label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 600;
          color: #444;
        }
        input {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 1rem;
          transition: border 0.2s;
        }
        input:focus {
          outline: none;
          border-color: #0070f3;
          box-shadow: 0 0 0 2px rgba(0,118,255,0.1);
        }
        .highlight input {
          border-color: #0070f3;
          background-color: #f5f9ff;
        }
        .hint {
          display: block;
          margin-top: 0.25rem;
          color: #666;
          font-size: 0.85rem;
        }
        button {
          width: 100%;
          padding: 1rem;
          background-color: #0070f3;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          transition: background 0.2s;
        }
        button:hover {
          background-color: #0061d5;
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
          animation: spin 1s ease-in-out infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .message {
          margin-top: 1.5rem;
          padding: 1rem;
          border-radius: 8px;
          font-size: 0.95rem;
        }
        .message.success {
          background-color: #e6ffed;
          color: #1a7f37;
          border: 1px solid #d2f8d9;
        }
        .message.error {
          background-color: #ffebee;
          color: #d32f2f;
          border: 1px solid #ffcdd2;
        }
        .message.info {
          background-color: #e3f2fd;
          color: #1976d2;
          border: 1px solid #bbdefb;
        }
      `}</style>
    </>
  );
}
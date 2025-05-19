import { useState } from 'react';
import Head from 'next/head';

export default function Home() {
  const [appleId, setAppleId] = useState('');
  const [password, setPassword] = useState('');
  const [appId, setAppId] = useState('');
  const [appVerId, setAppVerId] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setIsAuthLoading(true);
    setMessage('');

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

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${appId}.ipa`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setMessage('Tải xuống thành công!');
        setShowMfa(false);
        setVerificationCode('');
      } else {
        if (response.status === 401) {
          const errorData = await response.json();
          if (errorData.error === '2FA required') {
            setShowMfa(true);
            setMessage(errorData.details);
            setIsAuthLoading(false); // Chỉ dừng loading xác thực
            return; // Thoát sớm để không xử lý tiếp
          }
        }
        
        // Xử lý các lỗi khác
        const errorText = await response.text();
        try {
          const errorData = JSON.parse(errorText);
          setMessage(errorData.details || errorData.error || 'Lỗi khi tải xuống');
        } catch {
          setMessage(errorText || 'Lỗi không xác định');
        }
      }
    } catch (error) {
      setMessage(error.message || 'Lỗi kết nối');
    } finally {
      setIsLoading(false);
      setIsAuthLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Tải xuống IPA</title>
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
            />
          </div>

          <div className="form-group">
            <label htmlFor="appId">App ID (Bundle Identifier)</label>
            <input
              type="text"
              id="appId"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              required
              disabled={isLoading}
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
                placeholder="Nhập mã 6 chữ số từ thiết bị Apple"
              />
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

        {message && (
          <div className={`message ${message.includes('thành công') ? 'success' : 'error'}`}>
            {message}
          </div>
        )}
      </div>

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
          margin-bottom: 1rem;
        }
        label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
        }
        input {
          width: 100%;
          padding: 0.75rem;
          margin-bottom: 0.5rem;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 1rem;
        }
        .highlight input {
          border-color: #0070f3;
          background-color: #f5f9ff;
        }
        button {
          width: 100%;
          padding: 1rem;
          background-color: #0070f3;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1rem;
          font-weight: 600;
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
          animation: spin 1s ease-in-out infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .message {
          margin-top: 1.5rem;
          padding: 1rem;
          border-radius: 6px;
          font-size: 0.95rem;
        }
        .message.success {
          background-color: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        .message.error {
          background-color: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }
      `}</style>
    </>
  );
}
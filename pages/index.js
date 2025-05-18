import { useState } from 'react';
import Head from 'next/head';

export default function Home() {
  const [appleId, setAppleId] = useState('');
  const [password, setPassword] = useState('');
  const [appId, setAppId] = useState('');
  const [appVerId, setAppVerId] = useState('');
  const [code, setCode] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
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
          code: showMfa ? code : undefined
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
      } else {
        const errorData = await response.json();
        if (errorData.error === '2FA required') {
          setShowMfa(true);
          setMessage('Vui lòng nhập mã 2FA');
        } else {
          throw new Error(errorData.error || 'Lỗi khi tải xuống');
        }
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setIsLoading(false);
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
            />
          </div>

          <div className="form-group">
            <label htmlFor="appId">App ID</label>
            <input
              type="text"
              id="appId"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="appVerId">Phiên bản ứng dụng (App Version ID)</label>
            <input
              type="text"
              id="appVerId"
              value={appVerId}
              onChange={(e) => setAppVerId(e.target.value)}
              required
            />
          </div>

          {showMfa && (
            <div className="form-group">
              <label htmlFor="code">Mã 2FA (nếu cần)</label>
              <input
                type="text"
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          )}

          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Đang xử lý...' : 'Tải xuống'}
          </button>
        </form>

        {message && <div className="message">{message}</div>}
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
        }
        input {
          width: 100%;
          padding: 0.5rem;
          margin-bottom: 0.5rem;
        }
        button {
          width: 100%;
          padding: 0.75rem;
          background-color: #0070f3;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        button:disabled {
          background-color: #ccc;
          cursor: not-allowed;
        }
        .message {
          margin-top: 1rem;
          padding: 1rem;
          border-radius: 4px;
          background-color: ${message.includes('thành công') ? '#d4edda' : '#f8d7da'};
          color: ${message.includes('thành công') ? '#155724' : '#721c24'};
        }
      `}</style>
    </>
  );
}
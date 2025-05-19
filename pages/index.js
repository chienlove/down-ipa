import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

export default function Home() {
  // State quản lý dữ liệu form
  const [formData, setFormData] = useState({
    appleId: '',
    password: '',
    appId: '',
    appVerId: '',
    twoFactorCode: ''
  });

  // State quản lý giao diện
  const [show2FA, setShow2FA] = useState(false);
  const [message, setMessage] = useState({ type: '', content: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const twoFactorRef = useRef(null);
  const downloadRef = useRef(null);

  // Tự động focus vào trường 2FA khi hiển thị
  useEffect(() => {
    if (show2FA && twoFactorRef.current) {
      twoFactorRef.current.focus();
    }
  }, [show2FA]);

  // Tự động kích hoạt tải xuống khi có URL
  useEffect(() => {
    if (downloadUrl && downloadRef.current) {
      downloadRef.current.click();
      // Xóa URL sau khi đã tải xuống
      setTimeout(() => {
        setDownloadUrl(null);
      }, 1000);
    }
  }, [downloadUrl]);

  // Xử lý thay đổi giá trị các trường input
  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  // Xử lý submit form
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

      // Xử lý các loại phản hồi
      if (response.status === 401) {
        // Yêu cầu xác thực 2FA
        const data = await response.json();
        setShow2FA(true);
        setMessage({ 
          type: 'info', 
          content: data.message || 'Vui lòng nhập mã xác thực 2FA từ thiết bị Apple của bạn.' 
        });
        setCountdown(30); // Đếm ngược 30 giây
      } else if (response.ok) {
        // Kiểm tra loại nội dung phản hồi
        const contentType = response.headers.get('content-type');
        
        if (contentType && contentType.includes('application/octet-stream')) {
          // Phản hồi là file - xử lý tải xuống
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          setDownloadUrl(url);
          
          // Hiển thị thông báo thành công
          setMessage({ type: 'success', content: 'Tải xuống thành công!' });
          
          // Reset form 2FA nếu đã sử dụng
          if (show2FA) {
            setShow2FA(false);
            setFormData(prev => ({ ...prev, twoFactorCode: '' }));
          }
        } else {
          // Phản hồi là JSON - có thể là thông báo
          const data = await response.json();
          setMessage({ type: 'success', content: data.message || 'Thao tác thành công!' });
        }
      } else {
        // Xử lý lỗi khác
        const data = await response.json();
        setMessage({ 
          type: 'error', 
          content: data.message || 'Đã xảy ra lỗi không xác định' 
        });
        
        // Hiển thị chi tiết lỗi nếu có
        if (data.details) {
          console.error('Error details:', data.details);
        }
      }
    } catch (error) {
      setMessage({ 
        type: 'error', 
        content: error.message || 'Lỗi kết nối với máy chủ' 
      });
      console.error('Client error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Hiệu ứng đếm ngược cho mã 2FA
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
        <meta name="description" content="Công cụ tải xuống file IPA từ App Store Connect" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
        <h1 className="title">Tải xuống file IPA</h1>
        
        <form onSubmit={handleSubmit} className="form">
          {/* Trường Apple ID */}
          <div className="form-group">
            <label htmlFor="appleId">Apple ID</label>
            <input
              type="text"
              id="appleId"
              value={formData.appleId}
              onChange={handleChange}
              required
              disabled={isLoading}
              className="input"
              placeholder="email@example.com"
            />
          </div>

          {/* Trường Mật khẩu */}
          <div className="form-group">
            <label htmlFor="password">Mật khẩu</label>
            <input
              type="password"
              id="password"
              value={formData.password}
              onChange={handleChange}
              required
              disabled={isLoading}
              className="input"
              placeholder="••••••••"
            />
          </div>

          {/* Trường Bundle ID */}
          <div className="form-group">
            <label htmlFor="appId">Bundle ID</label>
            <input
              type="text"
              id="appId"
              value={formData.appId}
              onChange={handleChange}
              required
              disabled={isLoading}
              className="input"
              placeholder="com.example.app"
            />
          </div>

          {/* Trường Version ID (tùy chọn) */}
          <div className="form-group">
            <label htmlFor="appVerId">Version ID (tùy chọn)</label>
            <input
              type="text"
              id="appVerId"
              value={formData.appVerId}
              onChange={handleChange}
              disabled={isLoading}
              className="input"
              placeholder="123456789"
            />
          </div>

          {/* Trường 2FA (hiển thị khi cần) */}
          {show2FA && (
            <div className="form-group highlight">
              <label htmlFor="twoFactorCode">Mã xác thực 2FA</label>
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
                className="input"
                placeholder="123456"
              />
              {countdown > 0 && (
                <div className="countdown">Mã mới sau: {countdown}s</div>
              )}
            </div>
          )}

          {/* Nút Submit */}
          <button 
            type="submit" 
            disabled={isLoading}
            className={`submit-btn ${isLoading ? 'loading' : ''}`}
          >
            {isLoading ? (
              <>
                <span className="spinner"></span>
                {show2FA ? 'Đang xác thực...' : 'Đang đăng nhập...'}
              </>
            ) : (show2FA ? 'Xác thực & Tải xuống' : 'Tải xuống')}
          </button>

          {/* Hiển thị thông báo */}
          {message.content && (
            <div className={`message ${message.type}`}>
              {message.content}
            </div>
          )}
          
          {/* Link tải xuống ẩn */}
          {downloadUrl && (
            <a 
              ref={downloadRef}
              href={downloadUrl}
              download={`${formData.appId || 'app'}.ipa`}
              style={{display: 'none'}}
            >
              Download
            </a>
          )}
        </form>
      </main>

      {/* CSS */}
      <style jsx>{`
        .container {
          max-width: 600px;
          margin: 0 auto;
          padding: 2rem;
          min-height: 100vh;
        }
        .title {
          text-align: center;
          margin-bottom: 2rem;
          color: #333;
        }
        .form {
          background: #fff;
          padding: 2rem;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .form-group {
          margin-bottom: 1.5rem;
        }
        .form-group.highlight {
          background: #f0f7ff;
          padding: 1rem;
          border-radius: 6px;
          border-left: 3px solid #0070f3;
        }
        label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
          color: #444;
        }
        .input {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 1rem;
          transition: border 0.2s;
        }
        .input:focus {
          border-color: #0070f3;
          outline: none;
        }
        .submit-btn {
          width: 100%;
          padding: 1rem;
          background: #0070f3;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          transition: background 0.2s;
        }
        .submit-btn:hover:not(:disabled) {
          background: #0061d5;
        }
        .submit-btn:disabled {
          background: #ccc;
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
        .countdown {
          font-size: 0.8rem;
          color: #666;
          margin-top: 0.5rem;
          text-align: right;
        }
        .message {
          margin-top: 1rem;
          padding: 1rem;
          border-radius: 4px;
        }
        .message.success {
          background: #e6ffed;
          color: #1a7f37;
        }
        .message.error {
          background: #ffebee;
          color: #d32f2f;
        }
        .message.info {
          background: #e3f2fd;
          color: #1976d2;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
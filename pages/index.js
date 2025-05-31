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
  const [abortController, setAbortController] = useState(new AbortController());

  // Reset when unmount
  useEffect(() => {
    return () => abortController.abort();
  }, [abortController]);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    
    const controller = new AbortController();
    setAbortController(controller);
    
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
          ...(requires2FA && { twoFactorCode, sessionId })
        }),
        signal: controller.signal
      });

      const data = await response.json();

      // Handle 2FA requirement
      if (data.requiresTwoFactor) {
        setRequires2FA(true);
        setSessionId(data.sessionId);
        setMessage(data.message);
        setCountdown(120); // 2 minutes countdown
        return;
      }

      // Handle download
      if (response.ok && response.headers.get('content-type')?.includes('application/octet-stream')) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${form.appId}.ipa`;
        a.click();
        setMessage('Tải xuống thành công!');
        resetForm();
        return;
      }

      // Handle other responses
      if (response.ok) {
        setMessage(data.message || 'Thành công');
        resetForm();
        return;
      }

      throw new Error(data.message || 'Lỗi không xác định');

    } catch (error) {
      if (error.name === 'AbortError') {
        setMessage('Yêu cầu đã bị hủy');
      } else {
        console.error('Request failed:', error);
        setMessage(error.message || 'Lỗi kết nối máy chủ');
      }
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
    
    // Auto-submit on 6 digits
    if (value.length === 6 && requires2FA) {
      setTwoFALoading(true);
      setTimeout(() => handleSubmit(e), 300);
    }
  };

  return (
    <div className="container">
      <h1>Tải ứng dụng IPA</h1>
      
      <form onSubmit={handleSubmit}>
        {!requires2FA ? (
          <>
            <div className="form-group">
              <label>Apple ID:</label>
              <input
                type="email"
                value={form.appleId}
                onChange={(e) => setForm({...form, appleId: e.target.value})}
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Mật khẩu:</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({...form, password: e.target.value})}
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Bundle ID:</label>
              <input
                value={form.appId}
                onChange={(e) => setForm({...form, appId: e.target.value})}
                required
                disabled={loading}
                placeholder="com.example.app"
              />
              <small>Ví dụ: com.apple.mobilecal</small>
            </div>
          </>
        ) : (
          <div className="form-group">
            <label>Mã xác thực 2 yếu tố:</label>
            <input
              type="text"
              inputMode="numeric"
              value={twoFactorCode}
              onChange={handleTwoFactorChange}
              placeholder="Nhập mã 6 số"
              required
              autoFocus
              disabled={twoFALoading}
              className={twoFactorCode.length === 6 ? 'valid' : ''}
            />
            <p>Mã đã được gửi đến thiết bị của bạn {countdown > 0 && 
              `(${Math.floor(countdown/60)}:${String(countdown%60).padStart(2,'0')})`}
            </p>
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading || twoFALoading || (requires2FA && twoFactorCode.length !== 6)}
          className={loading || twoFALoading ? 'loading' : ''}
        >
          {twoFALoading ? 'Đang xác thực...' : 
           loading ? 'Đang xử lý...' : 
           requires2FA ? 'Xác nhận mã 2FA' : 'Tải về'}
        </button>

        {message && (
          <div className={`alert ${message.includes('thành công') ? 'success' : 
                          message.includes('2FA') ? 'info' : 'error'}`}>
            {message}
          </div>
        )}
      </form>
    </div>
  );
}
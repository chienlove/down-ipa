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

      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          ...(requires2FA && { 
            twoFactorCode,
            sessionId 
          })
        })
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      // Check content type first
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

        // Handle 2FA requirement
        if (data.requiresTwoFactor) {
          setRequires2FA(true);
          setSessionId(data.sessionId);
          setMessage(data.message);
          setCountdown(120);
          return;
        }

        // Handle error responses
        if (!response.ok) {
          if (data.debug) {
            console.error('Debug info:', data.debug);
          }
          throw new Error(data.message || `Server error: ${response.status}`);
        }

        // Handle other successful JSON responses
        if (data.message) {
          setMessage(data.message);
        }
        return;
      }

      // Handle non-JSON responses (like HTML error pages)
      const responseText = await response.text();
      console.log('Non-JSON response text (first 500 chars):', responseText.substring(0, 500));
      
      if (!response.ok) {
        // Try to extract error message from HTML if possible
        const errorMatch = responseText.match(/<title>(.*?)<\/title>/i);
        const errorTitle = errorMatch ? errorMatch[1] : `HTTP ${response.status}`;
        throw new Error(`Lỗi server: ${errorTitle}`);
      }

      throw new Error('Server trả về định dạng không mong đợi');

    } catch (error) {
      console.error('Request error:', error);
      
      // Handle network errors
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">IPA Downloader</h1>
          <p className="text-gray-600">Tải xuống file IPA từ App Store</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!requires2FA ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Apple ID
                </label>
                <input
                  type="email"
                  value={form.appleId}
                  onChange={(e) => setForm({...form, appleId: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mật khẩu
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({...form, password: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bundle ID
                </label>
                <input
                  type="text"
                  value={form.appId}
                  onChange={(e) => setForm({...form, appId: e.target.value})}
                  placeholder="com.example.app"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                  disabled={loading}
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mã xác thực 2FA {countdown > 0 && `(${countdown}s)`}
              </label>
              <input
                type="text"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-lg tracking-widest"
                maxLength={6}
                disabled={twoFALoading}
                autoFocus
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading || twoFALoading || (requires2FA && twoFactorCode.length !== 6)}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading || twoFALoading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Đang xử lý...
              </span>
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
              className="w-full bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Quay lại
            </button>
          )}
        </form>

        {message && (
          <div className={`mt-4 p-3 rounded-md ${
            message.includes('thành công') 
              ? 'bg-green-100 text-green-800' 
              : message.includes('Vui lòng nhập mã')
                ? 'bg-blue-100 text-blue-800'
                : 'bg-red-100 text-red-800'
          }`}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
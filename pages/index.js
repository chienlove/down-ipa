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

      // Get response text first to determine what type it is
      const responseText = await response.text();
      console.log('Raw response text:', responseText);
      console.log('Response text length:', responseText.length);

      // Check if response is a file download
      const contentType = response.headers.get('content-type');
      
      if (response.ok && contentType?.includes('application/octet-stream')) {
        // Convert text back to blob for file download
        const blob = new Blob([responseText], { type: 'application/octet-stream' });
        
        // Validate blob size
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

      // For non-file responses, parse as JSON
      let data;
      try {
        if (!responseText.trim()) {
          throw new Error('Phản hồi từ server rỗng');
        }

        // Try parsing as JSON
        data = JSON.parse(responseText);
        console.log('Parsed response data:', data);
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        console.error('Response status:', response.status);
        console.error('Response statusText:', response.statusText);
        console.error('Response text that failed to parse:', responseText.substring(0, 500));
        
        // If it's not JSON but response is OK, might be HTML error page
        if (response.status >= 200 && response.status < 300) {
          throw new Error('Server trả về định dạng không mong đợi');
        } else {
          throw new Error(`Lỗi server (${response.status}): ${response.statusText}`);
        }
      }

      // Handle successful JSON response
      if (data.requiresTwoFactor) {
        setRequires2FA(true);
        setSessionId(data.sessionId);
        setMessage(data.message);
        setCountdown(120);
        return;
      }

      // Handle error responses
      if (!response.ok) {
        // Log debug info if available
        if (data.debug) {
          console.error('Debug info:', data.debug);
        }
        throw new Error(data.message || `Server error: ${response.status}`);
      }
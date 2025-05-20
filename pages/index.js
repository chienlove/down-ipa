// pages/index.js

import { useState } from 'react';

export default function Home() {
  const [form, setForm] = useState({ appleId: '', password: '', appId: '' });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${form.appId || 'app'}.ipa`;
      a.click();
    } else {
      const error = await res.json();
      alert(`Lỗi: ${error.message || 'Không xác định'}`);
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Tải IPA với Apple ID</h1>
      <form onSubmit={handleSubmit}>
        <input name="appleId" placeholder="Apple ID" onChange={handleChange} required /><br />
        <input name="password" placeholder="Mật khẩu" type="password" onChange={handleChange} required /><br />
        <input name="appId" placeholder="Bundle ID hoặc App ID" onChange={handleChange} required /><br />
        <button type="submit" disabled={loading}>{loading ? 'Đang tải...' : 'Tải IPA'}</button>
      </form>
    </div>
  );
}
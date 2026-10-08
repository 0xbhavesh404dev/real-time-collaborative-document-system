import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api.js';

export default function Login({ onLogin }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(form) });
      onLogin(result.user, result.token);
      navigate('/dashboard');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">COLLAB DOCS</p>
        <h1>Welcome back.</h1>
        <p className="muted">Sign in to continue working with your team.</p>
        {error && <p className="error">{error}</p>}
        <label>Email<input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label>Password<input type="password" required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        <button className="primary-button" disabled={loading}>{loading ? 'Signing in...' : 'Login'}</button>
        <p className="form-footer">New here? <Link to="/register">Create an account</Link></p>
      </form>
    </main>
  );
}

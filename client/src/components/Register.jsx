import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api.js';

export default function Register({ onLogin }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (form.password !== form.confirmPassword) return setError('Passwords do not match');
    setLoading(true);
    setError('');
    try {
      const result = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(form) });
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
        <h1>Start collaborating.</h1>
        <p className="muted">Create a workspace for your next project.</p>
        {error && <p className="error">{error}</p>}
        <label>Username<input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        <label>Email<input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label>Password<input type="password" required minLength="6" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        <label>Confirm password<input type="password" required value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></label>
        <button className="primary-button" disabled={loading}>{loading ? 'Creating...' : 'Register'}</button>
        <p className="form-footer">Already registered? <Link to="/login">Login</Link></p>
      </form>
    </main>
  );
}

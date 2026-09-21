import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api.js';

export default function Dashboard({ user, onLogout }) {
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });

  async function loadChannels() {
    try {
      const result = await apiFetch('/channels');
      setChannels(result.channels);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => { loadChannels(); }, []);

  async function createChannel(event) {
    event.preventDefault();
    try {
      await apiFetch('/channels', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', description: '' });
      setShowCreate(false);
      loadChannels();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function joinChannel() {
    const channelName = window.prompt('Enter the channel name to join, for example: trial2');
    if (!channelName) return;
    setError('');
    try {
      await apiFetch('/channels/join-by-name', { method: 'POST', body: JSON.stringify({ name: channelName }) });
      loadChannels();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/dashboard">collab<span>•</span>docs</Link>
        <div className="user-menu"><span>{user.username}</span><button className="text-button" onClick={onLogout}>Logout</button></div>
      </header>
      <section className="content-wrap">
        <div className="page-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>Good to see you, {user.username}.</h1><p className="muted">Pick a channel and keep the work moving.</p></div><div className="button-row"><button className="secondary-button" onClick={joinChannel}>Join channel</button><button className="primary-button compact" onClick={() => setShowCreate(!showCreate)}>+ New channel</button></div></div>
        {error && <p className="error">{error}</p>}
        {showCreate && <form className="inline-form" onSubmit={createChannel}><input placeholder="Channel name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input placeholder="Short description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><button className="primary-button compact">Create</button></form>}
        <section className="channel-grid">
          {channels.map((channel) => <Link className="channel-card" to={`/channel/${channel.id}`} key={channel.id}><span className="channel-mark">#</span><div><h2>{channel.name}</h2><p>{channel.description || 'A shared project channel'}</p></div><span className="role-badge">{channel.role}</span></Link>)}
          {channels.length === 0 && <div className="empty-state">No channels yet. Create your first project space.</div>}
        </section>
      </section>
    </main>
  );
}

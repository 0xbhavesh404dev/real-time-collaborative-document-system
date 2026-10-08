import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api.js';

export default function Dashboard({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [invitations, setInvitations] = useState([]);
  const [respondingId, setRespondingId] = useState(null);
  const [notice, setNotice] = useState('');

  async function loadChannels() {
    try {
      const [channelResult, invitationResult] = await Promise.all([
        apiFetch('/channels'),
        apiFetch('/invitations/pending')
      ]);
      setChannels(channelResult.channels);
      setInvitations(invitationResult.invitations || []);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => { loadChannels(); }, []);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('newChannel') !== '1') return;
    setShowCreate(true);
    navigate('/dashboard', { replace: true });
  }, [location.search, navigate]);

  async function respondToInvitation(invitation, action) {
    setRespondingId(invitation.id);
    setError('');
    try {
      await apiFetch(`/invitations/${invitation.id}/${action}`, { method: 'POST' });
      setNotice(action === 'accepted'
        ? `You joined ${invitation.channel_name}.`
        : `Invitation to ${invitation.channel_name} declined.`);
      await loadChannels();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRespondingId(null);
    }
  }

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
    <section className="content-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>Good to see you, {user.username}.</h1>
          <p className="muted">Pick a channel and keep the work moving.</p>
        </div>
        <div className="button-row">
          <button className="secondary-button" onClick={joinChannel}>Join channel</button>
          <button className="primary-button compact" onClick={() => setShowCreate(!showCreate)}>+ New channel</button>
        </div>
      </div>
      {error && <p className="error" style={{ color: 'var(--red)', marginBottom: '16px' }}>{error}</p>}
      {showCreate && (
        <form className="inline-form" onSubmit={createChannel}>
          <input placeholder="Channel name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input placeholder="Short description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <button className="primary-button compact">Create</button>
        </form>
      )}
      {notice && <p className="notice" style={{ color: 'var(--accent)', marginBottom: '16px' }}>{notice}</p>}
      {invitations.length > 0 && (
        <section className="panel" style={{ marginBottom: '24px' }}>
          <div className="panel-heading">
            <div><p className="eyebrow">INVITATIONS</p><h2>Pending invitations</h2></div>
            <span className="count-badge">{invitations.length} waiting</span>
          </div>
          <div className="member-list">
            {invitations.map((invitation) => (
              <div className="member-row" key={invitation.id} style={{ gap: '10px', flexWrap: 'wrap' }}>
                <span className="member-name">
                  {invitation.channel_name}
                  <span className="muted" style={{ marginLeft: '8px', fontSize: '12px' }}>
                    invited by {invitation.inviter_username} as {invitation.role}
                  </span>
                </span>
                <span className="role-badge">{invitation.role}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                  <button
                    className="primary-button compact"
                    disabled={respondingId !== null}
                    onClick={() => respondToInvitation(invitation, 'accept')}
                  >
                    {respondingId === invitation.id ? 'Working...' : 'Accept'}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={respondingId !== null}
                    onClick={() => respondToInvitation(invitation, 'decline')}
                  >
                    Decline
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="channel-grid">
        {channels.map((channel) => (
          <Link className="channel-card" to={`/channel/${channel.id}`} key={channel.id}>
            <span className="channel-mark">#</span>
            <div>
              <h2>{channel.name}</h2>
              <p>{channel.description || 'A shared project channel'}</p>
            </div>
            <span className="role-badge">{channel.role}</span>
          </Link>
        ))}
        {channels.length === 0 && <div className="empty-state">No channels yet. Create your first project space.</div>}
      </section>
    </section>
  );
}

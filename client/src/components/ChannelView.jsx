import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';
import DocumentList from './DocumentList.jsx';
import UserList from './UserList.jsx';

export default function ChannelView({ user }) {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const [channel, setChannel] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [showDocumentForm, setShowDocumentForm] = useState(false);
  const [documentTitle, setDocumentTitle] = useState('');
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');

  async function load() {
    try {
      const [channelResult, documentResult, memberResult] = await Promise.all([
        apiFetch(`/channels/${channelId}`), apiFetch(`/channels/${channelId}/documents`), apiFetch(`/channels/${channelId}/members`)
      ]);
      setChannel({ ...channelResult.channel, role: channelResult.role });
      setDocuments(documentResult.documents);
      setMembers(memberResult.members);
    } catch (requestError) { setError(requestError.message); }
  }

  useEffect(() => { load(); }, [channelId]);

  async function createDocument(event) {
    event.preventDefault();
    if (!documentTitle.trim()) return setError('Document title is required');
    try {
      await apiFetch(`/channels/${channelId}/documents`, { method: 'POST', body: JSON.stringify({ title: documentTitle }) });
      setDocumentTitle('');
      setShowDocumentForm(false);
      setError('Document created');
      load();
    }
    catch (requestError) { setError(requestError.message); }
  }

  async function leaveChannel() {
    try { await apiFetch(`/channels/${channelId}/leave`, { method: 'POST' }); navigate('/dashboard'); }
    catch (requestError) { setError(requestError.message); }
  }

  async function inviteMember() {
    if (!inviteEmail.trim()) return setError('Invitee email is required');
    try {
      await apiFetch(`/channels/${channelId}/invite`, { method: 'POST', body: JSON.stringify({ inviteeEmail: inviteEmail.trim(), role: inviteRole }) });
      setInviteEmail('');
      setInviteRole('editor');
      setShowInviteForm(false);
      setError('Invitation stored successfully');
    }
    catch (requestError) { setError(requestError.message); }
  }

  async function deleteChannel() {
    if (!window.confirm('Delete this channel and its documents?')) return;
    try { await apiFetch(`/channels/${channelId}`, { method: 'DELETE' }); navigate('/dashboard'); }
    catch (requestError) { setError(requestError.message); }
  }

  if (!channel) return <main className="loading-state">Loading channel...</main>;
  const canEdit = ['admin', 'editor'].includes(channel.role);

  return <main className="app-shell"><header className="topbar"><Link className="brand" to="/dashboard">collab<span>•</span>docs</Link><Link className="text-button" to="/dashboard">← All channels</Link></header><section className="content-wrap"><div className="page-heading"><div><p className="eyebrow">CHANNEL / {channel.role.toUpperCase()}</p><h1>{channel.name}</h1><p className="muted">{channel.description || 'A focused place for shared work.'}</p></div><div className="button-row"><button className="secondary-button" onClick={() => setShowInviteForm(!showInviteForm)} disabled={channel.role !== 'admin'}>Invite</button><button className="secondary-button" onClick={leaveChannel}>Leave</button>{channel.role === 'admin' && <button className="secondary-button" onClick={deleteChannel}>Delete</button>}</div></div>{error && <p className="notice">{error}</p>}{showInviteForm && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); inviteMember(); }}><input autoFocus required type="email" placeholder="Member email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select><button className="primary-button compact" type="submit">Send invite</button><button className="text-button" type="button" onClick={() => setShowInviteForm(false)}>Cancel</button></form>}{showDocumentForm && <form className="inline-form" onSubmit={createDocument}><input autoFocus required placeholder="Document title" value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} /><button className="primary-button compact" type="submit">Create document</button><button className="text-button" type="button" onClick={() => setShowDocumentForm(false)}>Cancel</button></form>}<div className="two-column"><DocumentList documents={documents} canEdit={canEdit} onCreate={() => setShowDocumentForm(true)} /><UserList members={members} onlineUsers={[]} /></div></section></main>;
}

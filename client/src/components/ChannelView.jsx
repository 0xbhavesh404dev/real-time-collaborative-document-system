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
  const [invitations, setInvitations] = useState([]);

  async function load() {
    try {
      const [channelResult, documentResult, memberResult] = await Promise.all([
        apiFetch(`/channels/${channelId}`), apiFetch(`/channels/${channelId}/documents`), apiFetch(`/channels/${channelId}/members`)
      ]);
      setChannel({ ...channelResult.channel, role: channelResult.role });
      setDocuments(documentResult.documents);
      setMembers(memberResult.members);
      if (channelResult.role === 'admin') {
        const invitationResult = await apiFetch(`/invitations/channel/${channelId}`);
        setInvitations(invitationResult.invitations || []);
      }
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
      setError('Invitation sent. It stays pending until they accept from their dashboard.');
      apiFetch(`/invitations/channel/${channelId}`).then((result) => setInvitations(result.invitations || [])).catch(() => {});
    }
    catch (requestError) { setError(requestError.message); }
  }

  async function revokeInvitation(invitation) {
    try { await apiFetch(`/invitations/${invitation.id}`, { method: 'DELETE' }); apiFetch(`/invitations/channel/${channelId}`).then((result) => setInvitations(result.invitations || [])).catch(() => {}); }
    catch (requestError) { setError(requestError.message); }
  }

  async function deleteChannel() {
    if (!window.confirm('Delete this channel and its documents?')) return;
    try { await apiFetch(`/channels/${channelId}`, { method: 'DELETE' }); navigate('/dashboard'); }
    catch (requestError) { setError(requestError.message); }
  }

  if (!channel) return <main className="loading-state">Loading channel...</main>;
  const canEdit = ['admin', 'editor'].includes(channel.role);

  return <main className="app-shell"><header className="topbar"><Link className="brand" to="/dashboard">collab<span>•</span>docs</Link><Link className="text-button" to="/dashboard">← All channels</Link></header><section className="content-wrap"><div className="page-heading"><div><p className="eyebrow">CHANNEL / {channel.role.toUpperCase()}</p><h1>{channel.name}</h1><p className="muted">{channel.description || 'A focused place for shared work.'}</p></div><div className="button-row"><button className="secondary-button" onClick={() => setShowInviteForm(!showInviteForm)} disabled={channel.role !== 'admin'}>Invite</button><button className="secondary-button" onClick={leaveChannel}>Leave</button>{channel.role === 'admin' && <button className="secondary-button" onClick={deleteChannel}>Delete</button>}</div></div>{error && <p className="notice">{error}</p>}{showInviteForm && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); inviteMember(); }}><input autoFocus required type="email" placeholder="Member email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select><button className="primary-button compact" type="submit">Send invite</button><button className="text-button" type="button" onClick={() => setShowInviteForm(false)}>Cancel</button></form>}{showDocumentForm && <form className="inline-form" onSubmit={createDocument}><input autoFocus required placeholder="Document title" value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} /><button className="primary-button compact" type="submit">Create document</button><button className="text-button" type="button" onClick={() => setShowDocumentForm(false)}>Cancel</button></form>}{channel.role === 'admin' && invitations.length > 0 && <section className="panel member-panel" style={{ marginTop: '16px' }}><div className="panel-heading"><div><p className="eyebrow">INVITATIONS</p><h2>Channel invitations</h2></div><span className="count-badge">{invitations.length} total</span></div><div className="member-list">{invitations.map((invitation) => <div className="member-row" key={invitation.id} style={{ gap: '10px' }}><span className="member-name">{invitation.invitee_email}</span><span className="role-badge">{invitation.role}</span><span className="role-badge" style={{ textTransform: 'capitalize' }}>{invitation.status}</span><span className="muted" style={{ fontSize: '11px', marginLeft: 'auto' }}>by {invitation.inviter_username}</span>{invitation.status === 'pending' && <button className="text-button" onClick={() => revokeInvitation(invitation)}>Revoke</button>}</div>)}</div></section>}<div className="two-column"><DocumentList documents={documents} canEdit={canEdit} onCreate={() => setShowDocumentForm(true)} /><UserList members={members} onlineUsers={[]} /></div></section></main>;
}

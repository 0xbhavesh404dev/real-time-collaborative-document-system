import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  return `${value >= 100 ? Math.round(value) : value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export default function Layout({ user, onLogout, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { channelId, documentId } = useParams();
  const [channelName, setChannelName] = useState('Channel');
  const [resolvedChannelId, setResolvedChannelId] = useState(channelId || '');
  const [documentTitle, setDocumentTitle] = useState('Document');
  const [recentDocuments, setRecentDocuments] = useState([]);
  const [storageDetailsOpen, setStorageDetailsOpen] = useState(false);
  const [storage, setStorage] = useState(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const [respondingTo, setRespondingTo] = useState(null);
  const [notificationMessage, setNotificationMessage] = useState('');
  const notificationPanelRef = useRef(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordFormOpen, setPasswordFormOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const profilePanelRef = useRef(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState([]);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const globalSearchRef = useRef(null);
  const globalSearchContainerRef = useRef(null);

  useEffect(() => {
    let active = true;
    const storageKey = `syncpad_recent_documents_${user.id}`;
    const refreshRecentDocuments = async () => {
      const startedAt = Date.now();
      let saved = [];
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
        if (Array.isArray(parsed)) saved = parsed.filter((item) => item?.id != null).slice(0, 10);
      } catch { /* discard malformed recent-document data */ }

      const checked = await Promise.all(saved.map(async (item) => {
        try {
          const { document } = await apiFetch(`/documents/${item.id}`);
          if (!document) return null;
          const { channel } = await apiFetch(`/channels/${document.channel_id}`);
          return {
            ...item,
            id: String(document.id),
            title: document.title,
            channel: channel.name,
            channelId: String(channel.id),
          };
        } catch {
          // Deleted documents, deleted channels, and removed memberships all
          // make the document unavailable and should remove its stale link.
          return null;
        }
      }));
      if (!active) return;
      const valid = checked.filter(Boolean);
      setRecentDocuments((current) => {
        const byId = new Map(valid.map((item) => [String(item.id), item]));
        current.filter((item) => Number(item.visitedAt || 0) >= startedAt)
          .forEach((item) => byId.set(String(item.id), item));
        const next = [...byId.values()]
          .sort((a, b) => Number(b.visitedAt || 0) - Number(a.visitedAt || 0))
          .slice(0, 5);
        try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* optional convenience */ }
        return next;
      });
    };

    setRecentDocuments([]);
    refreshRecentDocuments();
    window.addEventListener('focus', refreshRecentDocuments);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshRecentDocuments);
    };
  }, [user.id]);

  useEffect(() => {
    const onDocumentsRemoved = (event) => {
      const documentIds = new Set((event.detail?.documentIds || []).map(String));
      const removedChannelId = event.detail?.channelId == null ? null : String(event.detail.channelId);
      setRecentDocuments((current) => {
        const next = current.filter((item) => !documentIds.has(String(item.id))
          && !(removedChannelId && String(item.channelId) === removedChannelId));
        try { localStorage.setItem(`syncpad_recent_documents_${user.id}`, JSON.stringify(next)); } catch { /* optional convenience */ }
        return next;
      });
    };
    window.addEventListener('workspace-documents-removed', onDocumentsRemoved);
    return () => window.removeEventListener('workspace-documents-removed', onDocumentsRemoved);
  }, [user.id]);

  async function submitPasswordChange(event) {
    event.preventDefault();
    setPasswordBusy(true);
    setProfileError('');
    setProfileMessage('');
    try {
      const result = await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(passwordForm),
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordFormOpen(false);
      setProfileMessage(result.message || 'Password changed successfully.');
    } catch (error) {
      setProfileError(error.message || 'Unable to change password.');
    } finally {
      setPasswordBusy(false);
    }
  }

  async function loadNotifications() {
    setNotificationsLoading(true);
    setNotificationsError('');
    try {
      const result = await apiFetch('/invitations/pending');
      setNotifications(result.invitations || []);
    } catch (error) {
      setNotificationsError(error.message || 'Unable to load notifications');
    } finally {
      setNotificationsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const refreshStorage = async () => {
      try {
        const result = await apiFetch('/auth/storage');
        if (!cancelled) {
          setStorage(result);
          setStorageUnavailable(false);
        }
      } catch {
        if (!cancelled) setStorageUnavailable(true);
      }
    };
    refreshStorage();
    const interval = window.setInterval(refreshStorage, 30000);
    window.addEventListener('focus', refreshStorage);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshStorage);
    };
  }, []);

  useEffect(() => {
    if (!globalSearchOpen) return undefined;
    const onPointerDown = (event) => {
      if (!globalSearchContainerRef.current?.contains(event.target)) setGlobalSearchOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [globalSearchOpen]);

  async function respondToInvitation(invitation, action) {
    setRespondingTo(invitation.id);
    setNotificationsError('');
    try {
      await apiFetch(`/invitations/${invitation.id}/${action}`, { method: 'POST' });
      setNotifications((current) => current.filter((item) => item.id !== invitation.id));
      setNotificationMessage(action === 'accept'
        ? `You joined ${invitation.channel_name}.`
        : `Invitation to ${invitation.channel_name} declined.`);
    } catch (error) {
      setNotificationsError(error.message || 'Unable to respond to invitation');
    } finally {
      setRespondingTo(null);
    }
  }

  function toggleNotifications() {
    const opening = !notificationsOpen;
    setNotificationsOpen(opening);
    if (opening) setProfileOpen(false);
    setNotificationMessage('');
    if (opening) loadNotifications();
  }

  useEffect(() => {
    let cancelled = false;
    async function loadBreadcrumb() {
      let targetChannelId = channelId;
      if (documentId) {
        try {
          const { document } = await apiFetch(`/documents/${documentId}`);
          if (cancelled) return;
          setDocumentTitle(document?.title || 'Document');
          targetChannelId = document?.channel_id;
        } catch { if (!cancelled) setDocumentTitle('Document'); }
      } else {
        setDocumentTitle('Document');
      }
      if (!cancelled) setResolvedChannelId(targetChannelId || '');
      if (targetChannelId) {
        try {
          const { channel } = await apiFetch(`/channels/${targetChannelId}`);
          if (!cancelled) setChannelName(channel?.name || 'Channel');
        } catch { if (!cancelled) setChannelName('Channel'); }
      } else if (!cancelled) setChannelName('Channel');
    }
    loadBreadcrumb();
    return () => { cancelled = true; };
  }, [channelId, documentId]);

  useEffect(() => {
    if (!documentId || documentTitle === 'Document') return;
    const item = { id: String(documentId), title: documentTitle, channel: channelName, channelId: String(resolvedChannelId || channelId || ''), visitedAt: Date.now() };
    setRecentDocuments((current) => {
      const next = [item, ...current.filter((entry) => String(entry.id) !== item.id)].slice(0, 5);
      try { localStorage.setItem(`syncpad_recent_documents_${user.id}`, JSON.stringify(next)); } catch { /* optional convenience */ }
      return next;
    });
  }, [channelId, channelName, documentId, documentTitle, resolvedChannelId, user.id]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const onPointerDown = (event) => {
      if (!notificationPanelRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    if (!profileOpen) return undefined;
    const onPointerDown = (event) => {
      if (!profilePanelRef.current?.contains(event.target)) setProfileOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [profileOpen]);

  useEffect(() => { loadNotifications(); }, []);

  useEffect(() => {
    const query = globalSearch.trim().toLocaleLowerCase();
    if (query.length < 2) {
      setGlobalSearchResults([]);
      setGlobalSearchLoading(false);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setGlobalSearchLoading(true);
      try {
        const { channels = [] } = await apiFetch('/channels');
        const channelResults = channels
          .filter((channel) => `${channel.name} ${channel.description || ''}`.toLocaleLowerCase().includes(query))
          .map((channel) => ({ type: 'Channel', label: channel.name, detail: channel.description || channel.role, href: `/channel/${channel.id}` }));
        const scopedResults = await Promise.all(channels.map(async (channel) => {
          const [documentResponse, memberResponse] = await Promise.all([
            apiFetch(`/channels/${channel.id}/documents`).catch(() => ({ documents: [] })),
            apiFetch(`/channels/${channel.id}/members`).catch(() => ({ members: [] }))
          ]);
          return {
            documents: (documentResponse.documents || []).filter((item) => `${item.title} ${channel.name}`.toLocaleLowerCase().includes(query))
              .map((item) => ({ type: 'Document', label: item.title, detail: channel.name, href: `/document/${item.id}` })),
            people: (memberResponse.members || []).filter((item) => `${item.username} ${item.email}`.toLocaleLowerCase().includes(query))
              .map((item) => ({ type: 'Person', label: item.username, detail: `${item.role} · ${channel.name}`, href: `/channel/${channel.id}` }))
          };
        }));
        if (!cancelled) setGlobalSearchResults([...channelResults, ...scopedResults.flatMap((item) => [...item.documents, ...item.people])].slice(0, 8));
      } catch {
        if (!cancelled) setGlobalSearchResults([]);
      } finally {
        if (!cancelled) setGlobalSearchLoading(false);
      }
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [globalSearch]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        globalSearchRef.current?.focus();
        setGlobalSearchOpen(true);
      }
      if (event.key === 'Escape') setGlobalSearchOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <button className="icon-btn sidebar-toggle sidebar-toggle-edge" type="button" onClick={() => setSidebarOpen((open) => !open)} data-tip={sidebarOpen ? 'Hide navigation' : 'Show navigation'} aria-label={sidebarOpen ? 'Hide navigation' : 'Show navigation'} aria-expanded={sidebarOpen}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M7 7h10M7 12h10M7 17h10"/></svg></button>
      <aside className="sidebar" aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
        <div className="brand">
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/><path d="M8.5 12h7M8.5 16h7"/></svg>
          </div>
          <div className="brand-name">Syncpad</div>
          <span className="brand-version">CRDT v2.4</span>
        </div>

        <Link className="new-doc" to="/dashboard?newChannel=1">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
          New Channel
        </Link>

        <div className="side-section">
          <div className="side-label">Workspace</div>
          <Link className="side-item" to="/dashboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>Channels</Link>
        </div>

        {recentDocuments.length > 0 && <div className="side-section recent-documents">
          <div className="side-label">Recent documents</div>
          {recentDocuments.map((item) => <Link className={`side-item recent-document${String(documentId) === String(item.id) ? ' active' : ''}`} key={item.id} to={`/document/${item.id}`} title={`${item.title} · ${item.channel}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 13h8M8 17h6"/></svg>
            <span><strong>{item.title}</strong><small>{item.channel}</small></span>
          </Link>)}
        </div>}

        <button className="storage" type="button" onClick={() => setStorageDetailsOpen((open) => !open)} aria-expanded={storageDetailsOpen} aria-label="Show storage details">
          <div className="storage-top"><span>Your storage</span><strong>{storage ? `${formatBytes(storage.usedBytes)} / ${formatBytes(storage.quotaBytes)}` : storageUnavailable ? 'Unavailable' : 'Loading…'}</strong></div>
          <div className="storage-bar" role="progressbar" aria-label="Account storage used" aria-valuemin="0" aria-valuemax={storage?.quotaBytes || 1} aria-valuenow={storage?.usedBytes || 0} aria-valuetext={storage ? `${formatBytes(storage.usedBytes)} of ${formatBytes(storage.quotaBytes)} used` : 'Storage usage is loading'}>
            <span style={{ width: storage ? `${Math.min(100, (storage.usedBytes / storage.quotaBytes) * 100)}%` : '0%' }} />
          </div>
          <small className="storage-caption">1 GB included per account · documents and saved versions</small>
        </button>
        {storageDetailsOpen && <div className="storage-details" role="dialog" aria-label="Storage details">
          <div className="storage-details-title">Storage breakdown</div>
          <div className="storage-detail-row"><span>Documents</span><strong>{storage ? formatBytes(storage.documentBytes || 0) : '—'}</strong></div>
          <div className="storage-detail-row"><span>Saved versions</span><strong>{storage ? formatBytes(storage.versionBytes || 0) : '—'}</strong></div>
          <div className="storage-detail-row storage-detail-total"><span>Used of 1 GB</span><strong>{storage ? `${formatBytes(storage.usedBytes)} / ${formatBytes(storage.quotaBytes)}` : '—'}</strong></div>
          <small>Includes document text, formatting data, and saved snapshots.</small>
        </div>}

        <div className="profile">
          <div className="avatar a-bh">{user.username.substring(0, 2).toUpperCase()}</div>
          <div className="profile-copy"><div className="profile-name">{user.username}</div><div className="profile-role">User</div></div>
          <button className="profile-more" onClick={onLogout}>Logout</button>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            <Link to="/dashboard">Channels</Link>
            {documentId ? (
              <><b>/</b><Link to={resolvedChannelId ? `/channel/${resolvedChannelId}` : '/dashboard'}>{channelName}</Link><b>/</b><strong>{documentTitle}</strong></>
            ) : channelId ? (
              <><b>/</b><strong>{channelName}</strong><b>/</b><span>Documents</span></>
            ) : (
              <><b>/</b><strong>Workspace</strong></>
            )}
          </div>
          <div className="search global-search" ref={globalSearchContainerRef}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
            <input ref={globalSearchRef} placeholder="Search channels, documents, people..." value={globalSearch} onFocus={() => setGlobalSearchOpen(true)} onChange={(event) => { setGlobalSearch(event.target.value); setGlobalSearchOpen(true); }} aria-label="Search channels, documents, and people" aria-expanded={globalSearchOpen && globalSearch.trim().length >= 2} aria-controls="global-search-results" />
            <span className="kbd">⌘K</span>
            {globalSearchOpen && globalSearch.trim().length >= 2 && <div className="global-search-results" id="global-search-results" role="listbox" aria-label="Search results">
              {globalSearchLoading ? <p className="global-search-empty">Searching your workspace…</p> : globalSearchResults.length ? globalSearchResults.map((result, index) => <Link key={`${result.type}-${result.href}-${index}`} className="global-search-result" to={result.href} role="option" aria-selected="false" onClick={() => { setGlobalSearch(''); setGlobalSearchOpen(false); }}><span className="global-search-kind">{result.type}</span><span className="global-search-copy"><strong>{result.label}</strong><small>{result.detail}</small></span><span aria-hidden="true">↗</span></Link>) : <p className="global-search-empty">No matching channels, documents, or people.</p>}
            </div>}
          </div>
          <div className="top-actions">
            <div className="notification-wrap" ref={notificationPanelRef}>
              <button className="icon-btn notification-button" type="button" onClick={toggleNotifications} data-tip="Notifications" aria-label="Notifications" aria-haspopup="dialog" aria-expanded={notificationsOpen}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
                {notifications.length > 0 && <span className="notification-count">{notifications.length > 9 ? '9+' : notifications.length}</span>}
              </button>
              {notificationsOpen && (
                <section className="notification-panel" role="dialog" aria-label="Notifications">
                  <div className="notification-panel-head">
                    <div><strong>Notifications</strong><small>{notifications.length ? `${notifications.length} pending invitation${notifications.length === 1 ? '' : 's'}` : 'Your workspace updates'}</small></div>
                    <button type="button" className="notification-refresh" onClick={loadNotifications} disabled={notificationsLoading} aria-label="Refresh notifications">↻</button>
                  </div>
                  {notificationsError && <p className="notification-error" role="alert">{notificationsError}</p>}
                  {notificationMessage && <p className="notification-success" role="status">{notificationMessage}</p>}
                  {notificationsLoading && notifications.length === 0 ? (
                    <p className="notification-empty">Loading notifications…</p>
                  ) : notifications.length === 0 ? (
                    <p className="notification-empty">You’re all caught up. New channel invitations will appear here.</p>
                  ) : (
                    <div className="notification-list">
                      {notifications.map((invitation) => (
                        <article className="notification-item" key={invitation.id}>
                          <span className="notification-dot" aria-hidden="true" />
                          <div className="notification-copy">
                            <strong>{invitation.channel_name}</strong>
                            <p>{invitation.inviter_username} invited you as {invitation.role}.</p>
                            <div className="notification-actions">
                              <button type="button" className="notification-accept" disabled={respondingTo !== null} onClick={() => respondToInvitation(invitation, 'accept')}>{respondingTo === invitation.id ? 'Working…' : 'Accept'}</button>
                              <button type="button" className="notification-decline" disabled={respondingTo !== null} onClick={() => respondToInvitation(invitation, 'decline')}>Decline</button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
            <div className="profile-menu-wrap" ref={profilePanelRef}>
              <button className="user-pill profile-trigger" type="button" onClick={() => { setProfileOpen((open) => !open); setNotificationsOpen(false); setProfileError(''); setProfileMessage(''); }} aria-haspopup="dialog" aria-expanded={profileOpen}>
                <div className="avatar a-bh">{user.username.substring(0, 2).toUpperCase()}</div>
                <div className="user-copy"><span className="name">{user.username}</span></div>
                <span className="chev">▾</span>
              </button>
              {profileOpen && (
                <section className="profile-panel" role="dialog" aria-label="Account menu">
                  <div className="profile-panel-user">
                    <div className="avatar a-bh">{user.username.substring(0, 2).toUpperCase()}</div>
                    <div><strong>{user.username}</strong><span>{user.email || 'Account details'}</span></div>
                  </div>
                  {profileError && <p className="profile-feedback error" role="alert">{profileError}</p>}
                  {profileMessage && <p className="profile-feedback success" role="status">{profileMessage}</p>}
                  {!passwordFormOpen ? (
                    <div className="profile-menu-actions">
                      <button type="button" onClick={() => { setPasswordFormOpen(true); setProfileError(''); setProfileMessage(''); }}>Change password</button>
                      <button type="button" className="profile-logout" onClick={onLogout}>Log out</button>
                    </div>
                  ) : (
                    <form className="password-change-form" onSubmit={submitPasswordChange}>
                      <strong>Change password</strong>
                      <label>Current password<input type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((form) => ({ ...form, currentPassword: event.target.value }))} required /></label>
                      <label>New password<input type="password" autoComplete="new-password" minLength={8} value={passwordForm.newPassword} onChange={(event) => setPasswordForm((form) => ({ ...form, newPassword: event.target.value }))} required /></label>
                      <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((form) => ({ ...form, confirmPassword: event.target.value }))} required /></label>
                      <div className="password-form-actions">
                        <button type="button" onClick={() => { setPasswordFormOpen(false); setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); setProfileError(''); }}>Cancel</button>
                        <button type="submit" disabled={passwordBusy}>{passwordBusy ? 'Saving…' : 'Update password'}</button>
                      </div>
                    </form>
                  )}
                </section>
              )}
            </div>
          </div>
        </header>
        <div className="workspace">
          {children}
        </div>
      </div>
    </div>
  );
}

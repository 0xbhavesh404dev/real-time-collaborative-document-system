import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';
import AIPanel from './AIPanel.jsx';

function formatTimestamp(dateString) {
  if (!dateString) return { full: '', timeOnly: '', relative: '' };
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now - date) / 1000));

  let relative = '';
  if (diffSec < 10) relative = 'Just now';
  else if (diffSec < 60) relative = `${diffSec}s ago`;
  else if (diffSec < 3600) relative = `${Math.floor(diffSec / 60)}m ago`;
  else if (diffSec < 86400) relative = `${Math.floor(diffSec / 3600)}h ago`;
  else relative = `${Math.floor(diffSec / 86400)}d ago`;

  const formattedTime = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  const formattedDate = date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return { full: `${formattedDate} at ${formattedTime}`, timeOnly: formattedTime, relative };
}

export default function HistoryPanel({ user }) {
  const { documentId } = useParams();
  const [activeTab, setActiveTab] = useState('history');
  const [versions, setVersions] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [restoringId, setRestoringId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Collaboration and Operations state from custom Editor events
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [opLog, setOpLog] = useState([]);
  // Every value below is measured at runtime: ack latency from the socket layer,
  // operation count from CRDT events, replica count from live room membership.
  const [healthStats, setHealthStats] = useState({
    opsSynced: 0,
    version: null,
    replicas: 0,
    latency: null
  });

  async function loadVersions() {
    setError('');
    setIsLoading(true);
    try {
      const result = await apiFetch(`/documents/${documentId}/versions?t=${Date.now()}`);
      const list = result.versions || [];
      setVersions(list);
      setHealthStats((prev) => ({ ...prev, version: list.length > 0 ? `v${list[0].id}` : null }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadVersions();

    // Listen to custom window events from Editor.jsx
    const onSaved = () => loadVersions();
    const onOnlineUsers = (e) => {
      setOnlineUsers(e.detail || []);
      setHealthStats(prev => ({ ...prev, replicas: (e.detail || []).length }));
    };
    // CRDT ops arrive on every keystroke; batch them into one render every 500ms
    let pendingOps = [];
    const opFlushTimer = setInterval(() => {
      if (pendingOps.length === 0) return;
      const batch = pendingOps;
      pendingOps = [];
      setOpLog(prev => [...batch.reverse(), ...prev].slice(0, 50));
    }, 500);
    const onCrdtOp = (e) => {
      if (e.detail) {
        pendingOps.push(e.detail);
      }
    };
    const onSyncStatus = (e) => {
      if (e.detail) {
        setHealthStats(prev => ({ ...prev, ...e.detail }));
      }
    };

    window.addEventListener('version-saved', onSaved);
    window.addEventListener('editor-online-users', onOnlineUsers);
    window.addEventListener('editor-crdt-op', onCrdtOp);
    window.addEventListener('editor-sync-status', onSyncStatus);

    return () => {
      clearInterval(opFlushTimer);
      window.removeEventListener('version-saved', onSaved);
      window.removeEventListener('editor-online-users', onOnlineUsers);
      window.removeEventListener('editor-crdt-op', onCrdtOp);
      window.removeEventListener('editor-sync-status', onSyncStatus);
    };
  }, [documentId]);

  async function previewVersion(version) {
    setError('');
    try {
      const result = await apiFetch(`/versions/${version.id}`);
      setPreview(result.version);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function restoreVersion(version) {
    if (!window.confirm(`Restore version V${version.id} ("${version.message}")?`)) return;
    setRestoringId(version.id);
    setError('');
    try {
      const result = await apiFetch(`/versions/${version.id}/restore`, { method: 'POST' });
      await loadVersions();
      setError(`Successfully restored version V${version.id}`);
      setPreview(null);
      window.dispatchEvent(
        new CustomEvent('document-restored-local', {
          detail: { content: result.restoredContent }
        })
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <aside className="rail">
      <AIPanel user={user} />
      <section className="rail-card" id="railTabsCard">
        <div className="rail-tabs">
          <button
            className={`rail-tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            Version History
          </button>
          <button
            className={`rail-tab ${activeTab === 'collab' ? 'active' : ''}`}
            onClick={() => setActiveTab('collab')}
          >
            Collaborators ({onlineUsers.length})
          </button>
          <button
            className={`rail-tab ${activeTab === 'ops' ? 'active' : ''}`}
            onClick={() => setActiveTab('ops')}
          >
            Operations
          </button>
        </div>

        {error && <div className="toast-banner toast-notice">{error}</div>}

        {/* TAB 1: VERSION HISTORY */}
        {activeTab === 'history' && (
          <div className="rail-body tab-panel" id="historyPanel">
            <div className="section-title">Snapshot timeline</div>

            {/* STICKY TOP PREVIEW CONTAINER */}
            {preview && (
              <div className="top-preview-container">
                <div className="preview-card-header">
                  <div>
                    <span className="badge badge-preview">PREVIEW V{preview.id}</span>
                    <h4 style={{ margin: '4px 0', color: '#fff' }}>{preview.message}</h4>
                    <p className="preview-meta" style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                      By <strong>{preview.username}</strong> • {formatTimestamp(preview.created_at).full}
                    </p>
                  </div>
                  <button className="btn-close" onClick={() => setPreview(null)} data-tip="Close preview">
                    ✕
                  </button>
                </div>

                <div className="preview-content-box">
                  {preview.content_html ? (
                    <iframe
                      className="version-preview-frame"
                      title={`Formatted preview of version ${preview.id}`}
                      sandbox=""
                      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;min-height:100%;background:#fff;color:#172033}body{box-sizing:border-box;padding:28px 32px;font:16px/1.6 Arial,sans-serif;overflow-wrap:anywhere}*{box-sizing:border-box}img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body>${preview.content_html}</body></html>`}
                    />
                  ) : <div className="version-preview-plain">{preview.content_snapshot || '(Empty document)'}</div>}
                </div>

                <div className="preview-card-footer" style={{ display: 'flex', gap: '8px' }}>
                  {user && (
                    <button
                      className="btn btn-primary compact"
                      disabled={restoringId !== null}
                      onClick={() => restoreVersion(preview)}
                    >
                      {restoringId === preview.id ? 'Restoring...' : '⏪ Restore'}
                    </button>
                  )}
                  <button className="btn btn-secondary compact" onClick={() => setPreview(null)}>
                    Close
                  </button>
                </div>
              </div>
            )}

            <div className="timeline">
              {versions.map((version, index) => {
                const isLatest = index === 0;
                const ts = formatTimestamp(version.created_at);
                const isPreviewing = preview?.id === version.id;

                return (
                  <div
                    className={`ver-item ${isLatest ? 'active' : ''} ${isPreviewing ? 'is-previewing' : ''}`}
                    key={version.id}
                  >
                    <div className="ver-top">
                      <span className="ver-id">v{version.id}</span>
                      {isLatest && <span className="current-tag">CURRENT</span>}
                    </div>
                    <div className="ver-date" title={ts.full}>{ts.relative} ago</div>
                    <div className="ver-name">👤 {version.username}</div>
                    <div className="ver-desc">{version.message}</div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                      <button className="restore" onClick={() => previewVersion(version)}>
                        👁️ Preview
                      </button>
                      {user && (
                        <button
                          className="restore"
                          style={{ color: '#38bdf8' }}
                          disabled={restoringId !== null}
                          onClick={() => restoreVersion(version)}
                        >
                          {restoringId === version.id ? 'Restoring...' : '⏪ Restore'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {versions.length === 0 && !isLoading && (
                <div className="empty-history-state" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)' }}>
                  <p>No version snapshots saved yet.</p>
                  <small>Use "Save Version" in the editor toolbar to snapshot work.</small>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: COLLABORATORS */}
        {activeTab === 'collab' && (
          <div className="rail-body tab-panel" id="collabPanel">
            <div className="section-title">{onlineUsers.length} online collaborator{onlineUsers.length === 1 ? '' : 's'}</div>
            <div className="collab-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
              {onlineUsers.map((u) => (
                <div className="collab-row" key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--line)', borderRadius: '8px' }}>
                  <div className="avatar a-bh" style={{ background: u.role === 'admin' ? 'var(--accent)' : 'var(--blue)', width: '32px', height: '32px', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '12px', fontWeight: 'bold', color: '#070b14' }}>
                    {u.username.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="collab-info" style={{ flex: '1', minWidth: 0 }}>
                    <div className="collab-name" style={{ fontSize: '13px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.username} {u.id === user.id ? '(you)' : ''}
                    </div>
                    <div className="collab-meta" style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'capitalize' }}>
                      {u.role || 'editor'}
                    </div>
                  </div>
                  <span className="state editing" style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 'bold' }}>Active</span>
                </div>
              ))}
              {onlineUsers.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)' }}>
                  No other collaborators online.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: OPERATIONS */}
        {activeTab === 'ops' && (
          <div className="rail-body tab-panel" id="opsPanel">
            <div className="section-title">Live CRDT operation log</div>
            <div className="operation-log" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', maxHeight: '350px', overflowY: 'auto' }}>
              {opLog.map((op, idx) => (
                <div className="operation" key={idx} style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--line)', borderRadius: '6px', font: '11px var(--mono)', color: 'var(--text-2)' }}>
                  <b style={{ color: op.type === 'insert' ? 'var(--accent)' : 'var(--red)', textTransform: 'uppercase', marginRight: '6px' }}>{op.type}</b>
                  <span className={op.type === 'insert' ? 'ins' : 'del'}>id={op.id}</span>
                  {op.leftId && <span> after <span className="site">{op.leftId}</span></span>}
                  {op.value && <span style={{ color: '#fff', marginLeft: '6px' }}>val="{op.value === '\n' ? '\\n' : op.value}"</span>}
                </div>
              ))}
              {opLog.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)' }}>
                  No operations captured yet. Start typing to see live CRDT operations!
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* COLLABORATION HEALTH CARD - all metrics measured at runtime */}
      <section className="rail-card" style={{ marginTop: '12px' }}>
        <div className="rail-body" style={{ padding: '16px' }}>
          <div className="section-title" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-3)', marginBottom: '10px' }}>Collaboration health</div>
          <div className="metric" style={{ minWidth: 0, background: 'rgba(255,255,255,.015)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', border: '1px solid var(--line)', borderRadius: '8px' }}>
            <div>
              <div className="v" style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--accent)' }}>{healthStats.opsSynced}</div>
              <div className="k" style={{ fontSize: '11px', color: 'var(--text-3)' }}>ops acknowledged this session</div>
            </div>
            <div style={{ font: '700 11px var(--mono)', color: '#5feac2', background: 'rgba(95,234,194,0.1)', padding: '4px 8px', borderRadius: '4px' }}>
              {healthStats.latency === null ? 'IDLE' : healthStats.latency}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
            <div className="metric" style={{ minWidth: 0, padding: '10px', background: 'rgba(255,255,255,.01)', border: '1px solid var(--line)', borderRadius: '8px' }}>
              <div className="v" style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>{healthStats.version === null ? 'none' : healthStats.version}</div>
              <div className="k" style={{ fontSize: '10px', color: 'var(--text-3)' }}>latest saved version</div>
            </div>
            <div className="metric" style={{ minWidth: 0, padding: '10px', background: 'rgba(255,255,255,.01)', border: '1px solid var(--line)', borderRadius: '8px' }}>
              <div className="v" style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>{healthStats.replicas}</div>
              <div className="k" style={{ fontSize: '10px', color: 'var(--text-3)' }}>editors in this document</div>
            </div>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: '10px', color: 'var(--text-3)', lineHeight: '1.5' }}>
            Latency is the measured round trip of the last CRDT operation ack from the server. Restart the page to reset the counter. Versions are counted from saved snapshots in PostgreSQL.
          </p>
        </div>
      </section>
    </aside>
  );
}

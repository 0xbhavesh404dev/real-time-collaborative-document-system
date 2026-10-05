import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';

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
  const [versions, setVersions] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [restoringId, setRestoringId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  async function loadVersions() {
    setError('');
    setIsLoading(true);
    try {
      const result = await apiFetch(`/documents/${documentId}/versions?t=${Date.now()}`);
      setVersions(result.versions || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadVersions();
    window.addEventListener('version-saved', loadVersions);
    return () => window.removeEventListener('version-saved', loadVersions);
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
    <aside className="history-panel-card">
      <header className="history-header">
        <div>
          <span className="panel-eyebrow">DOCUMENT LOGS</span>
          <h2>Version History</h2>
        </div>
        <button
          className="btn-refresh"
          onClick={loadVersions}
          disabled={isLoading}
          title="Refresh version history"
        >
          {isLoading ? '⏳' : '🔄'}
        </button>
      </header>

      {error && <div className="toast-banner toast-notice">{error}</div>}

      {/* STICKY TOP PREVIEW CONTAINER */}
      {preview && (
        <div className="top-preview-container">
          <div className="preview-card-header">
            <div>
              <span className="badge badge-preview">PREVIEW V{preview.id}</span>
              <h4>{preview.message}</h4>
              <p className="preview-meta">
                By <strong>{preview.username}</strong> • {formatTimestamp(preview.created_at).full}
              </p>
            </div>
            <button className="btn-close" onClick={() => setPreview(null)} title="Close Preview">
              ✕
            </button>
          </div>

          <div className="preview-content-box">
            <pre>{preview.content_snapshot || '(Empty document)'}</pre>
          </div>

          <div className="preview-card-footer">
            {user && (
              <button
                className="btn btn-primary compact"
                disabled={restoringId !== null}
                onClick={() => restoreVersion(preview)}
              >
                {restoringId === preview.id ? 'Restoring...' : '⏪ Restore This Version'}
              </button>
            )}
            <button className="btn btn-secondary compact" onClick={() => setPreview(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* TIMELINE VERSION LOGS */}
      <div className="version-timeline-list">
        {versions.map((version, index) => {
          const isLatest = index === 0;
          const ts = formatTimestamp(version.created_at);
          const isPreviewing = preview?.id === version.id;

          return (
            <article
              className={`timeline-item ${isLatest ? 'is-latest' : ''} ${isPreviewing ? 'is-previewing' : ''}`}
              key={version.id}
            >
              <div className="timeline-node">
                <span className="v-tag">V{version.id}</span>
              </div>

              <div className="timeline-body">
                <div className="v-title-row">
                  <strong className="v-message">{version.message}</strong>
                  {isLatest && <span className="badge badge-latest">LATEST</span>}
                </div>

                <div className="v-meta">
                  <span className="v-author">👤 {version.username}</span>
                  <span className="v-time" title={ts.full}>
                    ⏰ {ts.timeOnly} ({ts.relative})
                  </span>
                </div>

                <div className="v-actions">
                  <button className="btn-link" onClick={() => previewVersion(version)}>
                    👁️ Preview
                  </button>
                  {user && (
                    <button
                      className="btn-link btn-restore"
                      disabled={restoringId !== null}
                      onClick={() => restoreVersion(version)}
                    >
                      {restoringId === version.id ? 'Restoring...' : '⏪ Restore'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {versions.length === 0 && !isLoading && (
          <div className="empty-history-state">
            <p>No version snapshots saved yet.</p>
            <small>Use "Save Version" in the editor toolbar to snapshot work.</small>
          </div>
        )}
      </div>
    </aside>
  );
}

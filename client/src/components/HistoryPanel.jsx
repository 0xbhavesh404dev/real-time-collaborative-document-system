import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';

export default function HistoryPanel({ user }) {
  const { documentId } = useParams();
  const [versions, setVersions] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [restoringId, setRestoringId] = useState(null);

  async function loadVersions() {
    setError('');
    try {
      const result = await apiFetch(`/documents/${documentId}/versions?updated=${Date.now()}`);
      setVersions(result.versions);
    }
    catch (requestError) { setError(requestError.message); }
  }

  useEffect(() => {
    loadVersions();
    window.addEventListener('version-saved', loadVersions);
    return () => window.removeEventListener('version-saved', loadVersions);
  }, [documentId]);

  async function previewVersion(version) {
    try { const result = await apiFetch(`/versions/${version.id}`); setPreview(result.version); }
    catch (requestError) { setError(requestError.message); }
  }

  async function restoreVersion(version) {
    if (!window.confirm(`Restore version ${version.id}?`)) return;
    setRestoringId(version.id);
    setError('');
    try {
      const result = await apiFetch(`/versions/${version.id}/restore`, { method: 'POST' });
      await loadVersions();
      setError(`Version restored successfully as V${result.version.id}`);
      window.dispatchEvent(new CustomEvent('document-restored', {
        detail: { content: result.restoredContent }
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRestoringId(null);
    }
  }

  return <aside className="history-panel"><div className="panel-heading"><div><p className="eyebrow">DOCUMENT LOG</p><h2>Version history</h2></div></div>{error && <p className="notice">{error}</p>}{versions.map((version) => <article className="version-row" key={version.id}><div className="version-number">V{version.id}</div><div className="version-info"><strong>{version.message}</strong><small>{version.username} · {new Date(version.created_at).toLocaleDateString()}</small><div className="version-actions"><button className="text-button" onClick={() => previewVersion(version)}>Preview</button>{user && <button className="text-button" disabled={restoringId !== null} onClick={() => restoreVersion(version)}>{restoringId === version.id ? 'Restoring...' : 'Restore'}</button>}</div></div></article>)}{versions.length === 0 && <p className="muted">Saved versions will appear here.</p>}{preview && <div className="preview-box"><div className="panel-heading"><h3>Version {preview.id} preview</h3><button className="text-button" onClick={() => setPreview(null)}>Close</button></div><pre>{preview.content_snapshot}</pre></div>}</aside>;
}

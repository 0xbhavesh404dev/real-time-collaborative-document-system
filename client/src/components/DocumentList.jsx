import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function DocumentList({ documents, canEdit, onCreate, onDelete }) {
  const [deletingId, setDeletingId] = useState(null);

  async function deleteDocument(document) {
    if (!window.confirm(`Delete “${document.title}”? This also removes its saved versions and operation history.`)) return;
    setDeletingId(document.id);
    try { await onDelete?.(document); }
    finally { setDeletingId(null); }
  }

  return (
    <section className="panel document-list-panel">
      <div className="panel-heading"><div><p className="eyebrow">CHANNEL DOCUMENTS</p><h2>Shared files</h2></div>{canEdit && <button className="secondary-button compact" onClick={onCreate}>+ Create document</button>}</div>
      <div className="document-list">
        {documents.map((document) => <div className="document-row-wrap" key={document.id}><Link className="document-row" to={`/document/${document.id}`}><span className="file-icon">▤</span><span><strong>{document.title}</strong><small>Updated {new Date(document.updated_at).toLocaleString()}</small></span><span>→</span></Link>{canEdit && <button className="remove-member-button" type="button" disabled={deletingId === document.id} onClick={() => deleteDocument(document)} aria-label={`Delete ${document.title}`}>{deletingId === document.id ? 'Deleting…' : 'Delete'}</button>}</div>)}
        {documents.length === 0 && <p className="muted">No documents in this channel yet.</p>}
      </div>
    </section>
  );
}

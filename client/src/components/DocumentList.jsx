import { Link } from 'react-router-dom';

export default function DocumentList({ documents, canEdit, onCreate }) {
  return (
    <section className="panel document-list-panel">
      <div className="panel-heading"><div><p className="eyebrow">CHANNEL DOCUMENTS</p><h2>Shared files</h2></div>{canEdit && <button className="secondary-button compact" onClick={onCreate}>+ Create document</button>}</div>
      <div className="document-list">
        {documents.map((document) => <Link className="document-row" to={`/document/${document.id}`} key={document.id}><span className="file-icon">▤</span><span><strong>{document.title}</strong><small>Updated {new Date(document.updated_at).toLocaleString()}</small></span><span>→</span></Link>)}
        {documents.length === 0 && <p className="muted">No documents in this channel yet.</p>}
      </div>
    </section>
  );
}

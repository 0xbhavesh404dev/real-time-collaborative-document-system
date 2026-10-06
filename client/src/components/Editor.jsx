import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { createSocket } from '../socket.js';

function visibleNodes(state) {
  const nodes = Object.values(state.nodes || {});
  const ordered = [];
  function addChildren(leftId) {
    nodes
      .filter((node) => node.leftId === leftId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((node) => {
        ordered.push(node);
        addChildren(node.id);
      });
  }
  addChildren('HEAD');
  return ordered.filter((node) => !node.deleted);
}

function operationsForChange(oldText, newText, state, clientId, nextId) {
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) {
    start += 1;
  }
  let oldEnd = oldText.length - 1;
  let newEnd = newText.length - 1;
  while (oldEnd >= start && newEnd >= start && oldText[oldEnd] === newText[newEnd]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const nodes = visibleNodes(state);
  const operations = [];

  // Deletions
  for (let index = start; index <= oldEnd; index += 1) {
    if (nodes[index]?.id) {
      operations.push({ type: 'delete', id: nodes[index].id });
    }
  }

  // Insertions
  let leftId = start > 0 ? (nodes[start - 1]?.id || 'HEAD') : 'HEAD';
  for (let index = start; index <= newEnd; index += 1) {
    const id = `${clientId}:${nextId()}`;
    operations.push({ type: 'insert', id, leftId, value: newText[index] });
    leftId = id;
  }

  return operations;
}

export default function Editor({ user }) {
  const { documentId } = useParams();
  const socketRef = useRef(null);
  const editorSurfaceRef = useRef(null);
  const selectionRef = useRef(null);
  const stateRef = useRef({ nodes: {}, pendingOperations: {} });
  const textRef = useRef('');
  const clientId = useRef(localStorage.getItem('collab_client_id') || crypto.randomUUID());
  const counter = useRef(0);
  const typingTimer = useRef(null);
  const operationQueueRef = useRef([]);
  const isSendingOperationRef = useRef(false);

  const [document, setDocument] = useState(null);
  const [text, setText] = useState('');
  const [formattedContent, setFormattedContent] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState('');
  const [remoteCursors, setRemoteCursors] = useState([]);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [versionMessage, setVersionMessage] = useState('');
  const [isSavingVersion, setIsSavingVersion] = useState(false);

  useEffect(() => {
    localStorage.setItem('collab_client_id', clientId.current);
  }, []);

  useEffect(() => {
    const editorSurface = editorSurfaceRef.current;
    if (editorSurface && globalThis.document.activeElement !== editorSurface) {
      if (formattedContent && editorSurface.innerHTML !== formattedContent) {
        editorSurface.innerHTML = formattedContent;
      } else if (!formattedContent && editorSurface.innerText !== text) {
        editorSurface.textContent = text;
      }
    }
  }, [text, formattedContent]);

  useEffect(() => {
    let active = true;

    apiFetch(`/documents/${documentId}`)
      .then((result) => {
        if (active) setDocument(result.document);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });

    const socket = createSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-document', { documentId });
    });
    socket.on('connect_error', (socketError) => {
      if (active) setError(socketError.message || 'Unable to connect to the live document');
    });

    socket.on('initial-document', (payload) => {
      stateRef.current = payload.state || { nodes: {}, pendingOperations: {} };
      textRef.current = payload.content || '';
      setText(payload.content || '');
      setFormattedContent(payload.formattedContent || '');
      setDocument((current) => ({
        ...current,
        title: payload.title,
        role: payload.role
      }));
      setOnlineUsers(payload.users || []);
    });

    socket.on('crdt-operation', ({ operation }) => {
      applyOperation(operation);
    });

    socket.on('document-restored', (payload) => {
      stateRef.current = payload.state || { nodes: {}, pendingOperations: {} };
      textRef.current = payload.content || '';
      setText(payload.content || '');
      setFormattedContent(payload.contentHtml || '');
      setError('');
      setSaveSuccess(`Restored version: ${payload.version?.message || 'Updated'}`);
      setTimeout(() => setSaveSuccess(''), 4000);
      window.dispatchEvent(new CustomEvent('version-saved'));
    });

    socket.on('user-joined', ({ users }) => setOnlineUsers(users));
    socket.on('user-left', ({ users }) => setOnlineUsers(users));
    socket.on('user-typing', ({ username }) => setTypingUser(username));
    socket.on('user-stopped-typing', () => setTypingUser(''));
    socket.on('cursor-move', (cursor) => {
      setRemoteCursors((current) => [
        ...current.filter((item) => item.userId !== cursor.userId),
        cursor
      ]);
    });
    socket.on('formatting-update', ({ contentHtml }) => {
      setFormattedContent(contentHtml || '');
      if (editorSurfaceRef.current && globalThis.document.activeElement !== editorSurfaceRef.current) {
        editorSurfaceRef.current.innerHTML = contentHtml || textRef.current;
      }
    });
    socket.on('error', (payload) => setError(payload.message));

    const localRestoreListener = async () => {
      try {
        const result = await apiFetch(`/documents/${documentId}`);
        stateRef.current = result.document.crdt_state || { nodes: {}, pendingOperations: {} };
        textRef.current = result.document.current_content || '';
        setText(result.document.current_content || '');
        setFormattedContent(result.document.formatted_content || '');
      } catch (requestError) {
        setError(requestError.message);
      }
    };

    window.addEventListener('document-restored-local', localRestoreListener);

    return () => {
      active = false;
      socket.emit('leave-document', { documentId });
      socket.disconnect();
      window.removeEventListener('document-restored-local', localRestoreListener);
    };
  }, [documentId]);

  function applyOperation(operation) {
    if (!operation || !operation.id) return;
    const state = stateRef.current;
    state.nodes = state.nodes || {};
    state.pendingOperations = state.pendingOperations || {};

    if (operation.type === 'insert') {
      if (state.nodes[operation.id]) return; // ignore duplicate
      const leftId = operation.leftId || 'HEAD';
      if (leftId !== 'HEAD' && !state.nodes[leftId]) {
        state.pendingOperations[operation.id] = operation;
        return;
      }
      state.nodes[operation.id] = {
        id: operation.id,
        leftId,
        value: operation.value,
        deleted: false
      };
      delete state.pendingOperations[operation.id];
    } else if (operation.type === 'delete') {
      if (state.nodes[operation.id]) {
        state.nodes[operation.id].deleted = true;
      }
    }

    // Resolve any pending operations whose dependencies arrived
    let resolvePending = true;
    while (resolvePending) {
      resolvePending = false;
      for (const pending of Object.values(state.pendingOperations)) {
        if (pending.leftId === 'HEAD' || state.nodes[pending.leftId]) {
          delete state.pendingOperations[pending.id];
          state.nodes[pending.id] = {
            id: pending.id,
            leftId: pending.leftId || 'HEAD',
            value: pending.value,
            deleted: false
          };
          resolvePending = true;
        }
      }
    }

    const nextText = visibleNodes(state).map((node) => node.value).join('');

    textRef.current = nextText;
    setText(nextText);
    const editorSurface = editorSurfaceRef.current;
    if (editorSurface && globalThis.document.activeElement !== editorSurface) {
      editorSurface.innerHTML = formattedContent || nextText;
    }
  }

  function handleChange(event) {
    if (!document || !['admin', 'editor'].includes(document.role)) return;
    setError('');
    const newText = event.currentTarget.innerText;
    setFormattedContent(event.currentTarget.innerHTML);
    const operations = operationsForChange(
      textRef.current,
      newText,
      stateRef.current,
      clientId.current,
      () => {
        counter.current += 1;
        return counter.current;
      }
    );

    operations.forEach((operation) => {
      applyOperation(operation);
      operationQueueRef.current.push(operation);
    });
    flushOperationQueue();
    socketRef.current?.emit('formatting-update', {
      documentId,
      contentHtml: event.currentTarget.innerHTML
    });

    socketRef.current?.emit('typing-start', { documentId });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(
      () => socketRef.current?.emit('typing-stop', { documentId }),
      800
    );
  }

  function flushOperationQueue() {
    if (isSendingOperationRef.current || operationQueueRef.current.length === 0) return;
    const socket = socketRef.current;
    const operation = operationQueueRef.current[0];
    if (!socket?.connected) {
      setError('Connection lost. Reconnect before continuing to edit.');
      return;
    }

    isSendingOperationRef.current = true;
    socket.emit('crdt-operation', { documentId, operation }, (response) => {
      isSendingOperationRef.current = false;
      if (!response?.ok) {
        operationQueueRef.current = [];
        resyncDocument(response?.message || 'Unable to sync this edit');
        return;
      }
      operationQueueRef.current.shift();
      flushOperationQueue();
    });
  }

  async function resyncDocument(message) {
    try {
      const result = await apiFetch(`/documents/${documentId}`);
      const nextState = result.document.crdt_state || { nodes: {}, pendingOperations: {} };
      const nextText = result.document.current_content || '';
      stateRef.current = nextState;
      textRef.current = nextText;
      setText(nextText);
      setFormattedContent(result.document.formatted_content || '');
      if (editorSurfaceRef.current && globalThis.document.activeElement !== editorSurfaceRef.current) {
        editorSurfaceRef.current.innerHTML = result.document.formatted_content || nextText;
      }
      setError(`${message}. Document refreshed; please try that edit again.`);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function sendCursor(event) {
    const selection = window.getSelection();
    if (selection?.rangeCount) selectionRef.current = selection.getRangeAt(0).cloneRange();
    socketRef.current?.emit('cursor-move', {
      documentId,
      position: selection?.rangeCount ? selection.getRangeAt(0).startOffset : event.currentTarget.innerText.length
    });
  }

  function saveSelection() {
    const selection = window.getSelection();
    if (selection?.rangeCount && editorSurfaceRef.current?.contains(selection.anchorNode)) {
      selectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    const editorSurface = editorSurfaceRef.current;
    const selection = window.getSelection();
    if (!editorSurface || !selectionRef.current) return;
    if (!editorSurface.contains(selectionRef.current.startContainer)) return;
    selection.removeAllRanges();
    selection.addRange(selectionRef.current);
  }

  function applyFormat(command, value = null) {
    if (readOnly) return;
    restoreSelection();
    globalThis.document.execCommand('styleWithCSS', false, true);
    const applied = globalThis.document.execCommand(command, false, value);
    if (!applied && command === 'hiliteColor') {
      globalThis.document.execCommand('backColor', false, value);
    }
    editorSurfaceRef.current?.focus();
    saveSelection();
    const contentHtml = editorSurfaceRef.current?.innerHTML || '';
    setFormattedContent(contentHtml);
    socketRef.current?.emit('formatting-update', { documentId, contentHtml });
  }

  async function renameDocument() {
    const title = window.prompt('New document title', document.title);
    if (!title?.trim() || title === document.title) return;
    try {
      const result = await apiFetch(`/documents/${documentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim() })
      });
      setDocument((current) => ({ ...current, title: result.document.title }));
      setSaveSuccess('Title updated');
      setTimeout(() => setSaveSuccess(''), 3000);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function saveVersion() {
    if (!versionMessage.trim()) return setError('Please enter a description for this version');
    setIsSavingVersion(true);
    setError('');
    try {
      await apiFetch(`/documents/${documentId}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          message: versionMessage.trim(),
          content: text,
          contentHtml: editorSurfaceRef.current?.innerHTML || ''
        })
      });
      setVersionMessage('');
      setSaveSuccess('Version snapshot saved!');
      setTimeout(() => setSaveSuccess(''), 3000);
      window.dispatchEvent(new CustomEvent('version-saved'));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSavingVersion(false);
    }
  }

  if (!document) {
    if (error) {
      return (
        <section className="editor-card">
          <div className="empty-state">
            <h2>Unable to load this document</h2>
            <p>{error}</p>
            <p className="muted">Return to the channel and open an existing document, or create a new one.</p>
          </div>
        </section>
      );
    }

    return (
      <div className="editor-loading-skeleton">
        <div className="skeleton-spinner" />
        <p>Connecting to live document space...</p>
      </div>
    );
  }

  const readOnly = !['admin', 'editor'].includes(document.role);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const charCount = text.length;

  return (
    <section className="editor-card">
      <header className="editor-header">
        <div className="editor-title-group">
          <div className="status-pill-row">
            <span className="live-dot-pulse" />
            <span className="doc-type-badge">LIVE CRDT DOC</span>
            <span className="role-chip">{document.role}</span>
          </div>
          <div className="title-row">
            <h1>{document.title}</h1>
            {!readOnly && (
              <button
                className="icon-button"
                onClick={renameDocument}
                title="Rename Document"
              >
                ✏️
              </button>
            )}
          </div>
          <p className="active-collaborators-text">
            {onlineUsers.length} collaborator{onlineUsers.length === 1 ? '' : 's'} online
            {typingUser && <span className="typing-indicator"> · 💬 <strong>{typingUser}</strong> is typing...</span>}
          </p>
        </div>

        <div className="editor-actions">
          {!readOnly && (
            <div className="version-save-bar">
              <input
                className="version-input"
                placeholder="Version note (e.g. Draft 1)"
                value={versionMessage}
                disabled={readOnly || isSavingVersion}
                onChange={(e) => setVersionMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveVersion()}
              />
              <button
                className="btn btn-primary"
                disabled={readOnly || isSavingVersion}
                onClick={saveVersion}
              >
                {isSavingVersion ? 'Saving...' : '💾 Save Version'}
              </button>
            </div>
          )}
        </div>
      </header>

      {error && <div className="toast-banner toast-error">⚠️ {error}</div>}
      {saveSuccess && <div className="toast-banner toast-success">✨ {saveSuccess}</div>}

      <div className="editor-workspace">
        {!readOnly && (
          <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
            <button type="button" className="format-button format-bold" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => applyFormat('bold')} title="Bold">B</button>
            <button type="button" className="format-button format-italic" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => applyFormat('italic')} title="Italic">I</button>
            <button type="button" className="format-button format-underline" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => applyFormat('underline')} title="Underline">U</button>
            <label className="format-color" title="Text color" onMouseDown={saveSelection}>
              <span>A</span>
              <input type="color" defaultValue="#10b981" onChange={(event) => applyFormat('foreColor', event.target.value)} onClick={saveSelection} aria-label="Text color" />
            </label>
            <label className="format-color format-highlight" title="Highlight color" onMouseDown={saveSelection}>
              <span>▰</span>
              <input type="color" defaultValue="#fef08a" onChange={(event) => applyFormat('hiliteColor', event.target.value)} onClick={saveSelection} aria-label="Highlight color" />
            </label>
            <button type="button" className="format-button format-clear" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => applyFormat('removeFormat')} title="Clear formatting">⌫</button>
            <span className="toolbar-hint">Select text to format</span>
          </div>
        )}
        <div
          ref={editorSurfaceRef}
          className="editor-textarea editor-surface"
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onSelect={sendCursor}
          onClick={sendCursor}
          onKeyUp={sendCursor}
          onInput={handleChange}
          role="textbox"
          aria-label="Document editor"
          data-placeholder={readOnly ? 'View-only access' : 'Start typing together in real-time...'}
        ></div>

        {remoteCursors.length > 0 && (
          <div className="cursor-indicators-bar">
            {remoteCursors.map((cursor) => (
              <span className="cursor-tag" key={cursor.userId}>
                👤 {cursor.username} (pos: {cursor.position})
              </span>
            ))}
          </div>
        )}
      </div>

      <footer className="editor-footer">
        <div className="presence-avatars">
          {onlineUsers.map((u) => (
            <div className="avatar-chip" key={u.id} title={`${u.username} (${u.role})`}>
              <span className="avatar-initial">{u.username.substring(0, 2).toUpperCase()}</span>
              <span className="presence-status-dot" />
              <span className="avatar-name">{u.username}</span>
            </div>
          ))}
        </div>

        <div className="doc-stats">
          <span>{wordCount} words</span>
          <span className="stat-divider">•</span>
          <span>{charCount} characters</span>
        </div>
      </footer>
    </section>
  );
}

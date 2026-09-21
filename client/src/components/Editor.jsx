/*
  CRDT means Conflict-Free Replicated Data Type. Instead of replacing the whole
  document whenever someone types, each client creates small operations.
  Every character is a node with an id and a link to the character on its left.
  Insert operations add nodes, while delete operations mark nodes as tombstones.
  Tombstones stay in the state because later operations may refer to them.
  Operation ids use a client id and counter, so duplicate operations are safe.
  Concurrent siblings are sorted by id instead of arrival order. Pending
  operations wait until their left-side dependency arrives. Socket.IO transfers
  these operations between replicas, and deterministic ordering lets replicas
  converge to the same visible text.
*/
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { createSocket } from '../socket.js';

function visibleNodes(state) {
  const nodes = Object.values(state.nodes || {});
  const ordered = [];
  function addChildren(leftId) {
    nodes.filter((node) => node.leftId === leftId).sort((a, b) => a.id.localeCompare(b.id)).forEach((node) => { ordered.push(node); addChildren(node.id); });
  }
  addChildren('HEAD');
  return ordered.filter((node) => !node.deleted);
}

function operationsForChange(oldText, newText, state, clientId, nextId) {
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start += 1;
  let oldEnd = oldText.length - 1;
  let newEnd = newText.length - 1;
  while (oldEnd >= start && newEnd >= start && oldText[oldEnd] === newText[newEnd]) { oldEnd -= 1; newEnd -= 1; }
  const nodes = visibleNodes(state);
  const operations = [];
  for (let index = start; index <= oldEnd; index += 1) operations.push({ type: 'delete', id: nodes[index]?.id });
  let leftId = start > 0 ? nodes[start - 1]?.id : 'HEAD';
  for (let index = start; index <= newEnd; index += 1) { const id = `${clientId}:${nextId()}`; operations.push({ type: 'insert', id, leftId, value: newText[index] }); leftId = id; }
  return operations.filter((operation) => operation.id);
}

export default function Editor({ user }) {
  const { documentId } = useParams();
  const socketRef = useRef(null);
  const stateRef = useRef({ nodes: {}, pendingOperations: {} });
  const textRef = useRef('');
  const clientId = useRef(localStorage.getItem('collab_client_id') || crypto.randomUUID());
  const counter = useRef(0);
  const typingTimer = useRef(null);
  const [document, setDocument] = useState(null);
  const [text, setText] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState('');
  const [remoteCursors, setRemoteCursors] = useState([]);
  const [error, setError] = useState('');
  const [versionMessage, setVersionMessage] = useState('');

  useEffect(() => { localStorage.setItem('collab_client_id', clientId.current); }, []);
  useEffect(() => {
    let active = true;
    apiFetch(`/documents/${documentId}`).then((result) => { if (active) setDocument(result.document); }).catch((requestError) => setError(requestError.message));
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('join-document', { documentId }));
    socket.on('initial-document', (payload) => { stateRef.current = payload.state; textRef.current = payload.content; setText(payload.content); setDocument((current) => ({ ...current, title: payload.title, role: payload.role })); setOnlineUsers(payload.users); });
    socket.on('crdt-operation', ({ operation }) => { applyOperation(operation); });
    socket.on('user-joined', ({ users }) => setOnlineUsers(users));
    socket.on('user-left', ({ users }) => setOnlineUsers(users));
    socket.on('user-typing', ({ username }) => setTypingUser(username));
    socket.on('user-stopped-typing', () => setTypingUser(''));
    socket.on('cursor-move', (cursor) => setRemoteCursors((current) => [...current.filter((item) => item.userId !== cursor.userId), cursor]));
    socket.on('error', (payload) => setError(payload.message));
    const restoreListener = async (event) => {
      if (event.detail?.content !== undefined) {
        textRef.current = event.detail.content;
        setText(event.detail.content);
      }
      try {
        const result = await apiFetch(`/documents/${documentId}`);
        stateRef.current = result.document.crdt_state;
        textRef.current = result.document.current_content;
        setText(result.document.current_content);
      } catch (requestError) {
        setError(requestError.message);
      }
    };
    window.addEventListener('document-restored', restoreListener);
    return () => { active = false; socket.emit('leave-document', { documentId }); socket.disconnect(); window.removeEventListener('document-restored', restoreListener); };
  }, [documentId]);

  function applyOperation(operation) {
    const state = stateRef.current;
    if (state.nodes[operation.id]) return;
    if (operation.type === 'insert') {
      if (operation.leftId !== 'HEAD' && !state.nodes[operation.leftId]) { state.pendingOperations[operation.id] = operation; return; }
      state.nodes[operation.id] = { ...operation, deleted: false };
    } else if (state.nodes[operation.id]) state.nodes[operation.id].deleted = true;
    for (const pending of Object.values(state.pendingOperations)) if (state.nodes[pending.leftId] || pending.leftId === 'HEAD') { delete state.pendingOperations[pending.id]; applyOperation(pending); }
    const nextText = visibleNodes(state).map((node) => node.value).join('');
    textRef.current = nextText;
    setText(nextText);
  }

  function handleChange(event) {
    if (!document || !['admin', 'editor'].includes(document.role)) return;
    const newText = event.target.value;
    const operations = operationsForChange(textRef.current, newText, stateRef.current, clientId.current, () => { counter.current += 1; return counter.current; });
    operations.forEach((operation) => { applyOperation(operation); socketRef.current?.emit('crdt-operation', { documentId, operation }); });
    socketRef.current?.emit('typing-start', { documentId });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socketRef.current?.emit('typing-stop', { documentId }), 800);
  }

  function sendCursor(event) {
    socketRef.current?.emit('cursor-move', { documentId, position: event.target.selectionStart });
  }

  async function renameDocument() {
    const title = window.prompt('New document title', document.title);
    if (!title?.trim()) return;
    try {
      const result = await apiFetch(`/documents/${documentId}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      setDocument((current) => ({ ...current, title: result.document.title }));
    } catch (requestError) { setError(requestError.message); }
  }

  async function saveVersion() {
    if (!versionMessage.trim()) return setError('Enter a version message');
    try {
      await apiFetch(`/documents/${documentId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ message: versionMessage, content: text })
      });
      setVersionMessage('');
      setError('Version saved');
      window.dispatchEvent(new CustomEvent('version-saved'));
    }
    catch (requestError) { setError(requestError.message); }
  }

  if (!document) return <main className="loading-state">Opening document...</main>;
  const readOnly = !['admin', 'editor'].includes(document.role);
  return <section className="editor-panel"><div className="editor-heading"><div><p className="eyebrow">LIVE DOCUMENT</p><h1>{document.title}</h1><p className="muted">{onlineUsers.length} collaborator{onlineUsers.length === 1 ? '' : 's'} online {typingUser && `· ${typingUser} is typing`}</p>{remoteCursors.map((cursor) => <small key={cursor.userId}>{cursor.username} · cursor at {cursor.position}</small>)}</div><div className="save-version">{!readOnly && <button className="secondary-button compact" onClick={renameDocument}>Rename</button>}<input placeholder="Version message" value={versionMessage} disabled={readOnly} onChange={(event) => setVersionMessage(event.target.value)} /><button className="primary-button compact" disabled={readOnly} onClick={saveVersion}>Save version</button></div></div>{error && <p className="notice">{error}</p>}<textarea className="editor-textarea" readOnly={readOnly} value={text} onChange={handleChange} onSelect={sendCursor} placeholder="Start writing together..." /><div className="presence-strip">{onlineUsers.map((onlineUser) => <span className="presence-chip" key={onlineUser.id}>● {onlineUser.username} <small>{onlineUser.role}</small></span>)}</div></section>;
}

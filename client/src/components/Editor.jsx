import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../api.js';
import { createSocket } from '../socket.js';
import {
  createCrdtState,
  applyRemoteOperation,
  visibleNodes,
  getText as getCrdtText
} from '../utils/crdtClient.js';
import { getCaretTextOffset, getOffsetRect } from '../utils/cursorPosition.js';
import useAutocomplete from '../hooks/useAutocomplete.js';
import usePlagiarism from '../hooks/usePlagiarism.js';
import useGrammar from '../hooks/useGrammar.js';
import AICommandBar from './AICommandBar.jsx';
import {
  applyFormat as execFormat,
  changeIndent,
  setFontFamily,
  setFontSize,
  setBlockStyle,
  insertImage,
  FONT_FAMILIES,
  FONT_SIZES,
  LINE_HEIGHTS,
  TEXT_ALIGNMENTS
} from '../utils/formatting.js';

// Maximum file size for image uploads (2MB)
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

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

export default function Editor({ user, onDocumentUnavailable }) {
  const { documentId } = useParams();
  const socketRef = useRef(null);
  const editorSurfaceRef = useRef(null);
  const selectionRef = useRef(null);
  const stateRef = useRef(createCrdtState());
  const textRef = useRef('');
  const clientId = useRef(localStorage.getItem('collab_client_id') || crypto.randomUUID());
  const counter = useRef(0);
  const typingTimer = useRef(null);
  const statsTimer = useRef(null);
  const formattingTimer = useRef(null);
  const pendingHtmlRef = useRef('');
  const cursorLayerRef = useRef(null);
  const lastLatencyRef = useRef(0);
  const opsSyncedRef = useRef(0);
  const [, setCursorLayoutTick] = useState(0);

  const CURSOR_COLORS = ['#3e86e6', '#9b6df0', '#e25aa3', '#e8a13a', '#2ee7ad', '#ff5d8f'];
  function cursorColorFor(userId) {
    const key = String(userId);
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return CURSOR_COLORS[hash % CURSOR_COLORS.length];
  }
  const formattedContentRef = useRef('');
  const operationQueueRef = useRef([]);
  const isSendingOperationRef = useRef(false);
  const fileInputRef = useRef(null);
  const versionMessageRef = useRef(null);

  const [document, setDocument] = useState(null);
  const [text, setText] = useState('');
  const [formattedContent, setFormattedContent] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState('');
  const [remoteCursors, setRemoteCursors] = useState([]);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [versionMessage, setVersionMessage] = useState('');
  const [showVersionForm, setShowVersionForm] = useState(false);
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [formatState, setFormatState] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    superscript: false,
    subscript: false,
    unorderedList: false,
    orderedList: false,
    blockFormat: 'p',
    alignment: 'left',
    fontSize: '16px',
    fontFamily: 'inherit',
    lineHeight: '1.5',
    foreColor: '#0f8c69',
    backColor: '#d7faea'
  });
  const [imageUploadError, setImageUploadError] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHighlightRects, setSearchHighlightRects] = useState([]);
  const [presentationMode, setPresentationMode] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'ok' });
  const searchInputRef = useRef(null);
  const [selectedText, setSelectedText] = useState('');
  const [aiSettings, setAiSettings] = useState({ autocomplete: true, grammarAssistant: true, plagiarism: true });
  const aiEnabled = Boolean(document && ['admin', 'editor'].includes(document.role));
  const autocomplete = useAutocomplete({ documentId, text, enabled: aiEnabled && aiSettings.autocomplete });
  const plagiarism = usePlagiarism({ documentId, text, enabled: aiEnabled && aiSettings.plagiarism });
  const grammar = useGrammar({ documentId, text, enabled: aiEnabled && aiSettings.grammarAssistant });

  useEffect(() => {
    localStorage.setItem('collab_client_id', clientId.current);
  }, []);

  useEffect(() => {
    formattedContentRef.current = formattedContent;
  }, [formattedContent]);

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
    setDocument(null);
    setError('');
    onDocumentUnavailable?.(false);

    apiFetch(`/documents/${documentId}`)
      .then((result) => {
        if (active) {
          setDocument(result.document);
          onDocumentUnavailable?.(false);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError.message);
          onDocumentUnavailable?.(true);
        }
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
      stateRef.current = createCrdtState(payload.state);
      textRef.current = payload.content || '';
      setText(payload.content || '');
      formattedContentRef.current = payload.formattedContent || '';
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
      refreshEditorStats();
      syncEditorSurface();
    });

    socket.on('document-restored', (payload) => {
      stateRef.current = createCrdtState(payload.state);
      textRef.current = payload.content || '';
      setText(payload.content || '');
      formattedContentRef.current = payload.contentHtml || '';
      setFormattedContent(payload.contentHtml || '');
      setError('');
      setSaveSuccess(`Restored version: ${payload.version?.message || 'Updated'}`);
      setTimeout(() => setSaveSuccess(''), 4000);
      window.dispatchEvent(new CustomEvent('version-saved'));
    });

    socket.on('user-joined', ({ users }) => setOnlineUsers(users));
    socket.on('user-left', ({ users }) => {
      setOnlineUsers(users);
      const stillHere = new Set((users || []).map((item) => item.id));
      setRemoteCursors((current) => current.filter((cursor) => stillHere.has(cursor.userId)));
    });
    socket.on('user-typing', ({ username }) => setTypingUser(username));
    socket.on('user-stopped-typing', () => setTypingUser(''));
    socket.on('cursor-move', (cursor) => {
      setRemoteCursors((current) => [
        ...current.filter((item) => item.userId !== cursor.userId),
        { ...cursor, color: cursorColorFor(cursor.userId), colorIndex: cursorColorFor(cursor.userId) }
      ]);
    });
    socket.on('formatting-update', ({ contentHtml }) => {
      formattedContentRef.current = contentHtml || '';
      setFormattedContent(contentHtml || '');
      syncEditorSurface();
    });
    socket.on('error', (payload) => setError(payload.message));

    const localRestoreListener = async () => {
      try {
        const result = await apiFetch(`/documents/${documentId}`);
        stateRef.current = createCrdtState(result.document.crdt_state);
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
  }, [documentId, onDocumentUnavailable]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('editor-document-text', { detail: { text } }));
  }, [text]);

  useEffect(() => {
    const onReplace = (event) => {
      const { text: replacement = '', original = '', replaceDocument = false, expectedSourceText, expectedDocumentId } = event.detail || {};
      let applied = false;
      if ((expectedDocumentId != null && String(expectedDocumentId) !== String(documentId)) || (expectedSourceText != null && String(expectedSourceText).trim() !== String(textRef.current || '').trim())) {
        event.detail.reason = 'The document changed after this suggestion. The latest text is being checked.';
        setToast({ message: event.detail.reason, type: 'info' });
        grammar.check(textRef.current, true);
      } else if (replaceDocument) {
        applied = replaceEntireDocument(replacement);
      } else if (original) {
        const savedRange = selectionRef.current;
        if (savedRange && !savedRange.collapsed && savedRange.toString().trim() === original.trim()) {
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(savedRange);
          applied = replaceCurrentSelection(replacement);
        } else {
          applied = replaceExactText(original, replacement);
        }
      } else if (selectionRef.current && !selectionRef.current.collapsed) {
        applied = replaceCurrentSelection(replacement);
      }
      event.detail.applied = applied;
      if (!applied && !event.detail.reason) setToast({ message: 'Could not find the original text. Select it again and retry.', type: 'error' });
    };
    const onAcceptAutocomplete = (event) => insertAutocomplete(event.detail?.text || '');
    const onAiSettings = (event) => {
      const next = event.detail || {};
      setAiSettings((current) => ({ ...current, ...next }));
    };
    const onAcceptGrammar = (event) => {
      const issue = event.detail;
      if (!issue?.original || !issue?.suggestion) return;
      if (String(issue.documentId) !== String(documentId) || issue.sourceText !== String(textRef.current || '').trim()) {
        setToast({ message: 'The document changed after this suggestion. Checking the latest text…', type: 'info' });
        grammar.check(textRef.current, true);
        return;
      }
      const applied = replaceExactText(issue.original, issue.suggestion);
      if (applied) setToast({ message: 'Grammar suggestion accepted', type: 'ok' });
      else {
        setToast({ message: 'The source text changed. Checking the latest text…', type: 'info' });
        grammar.check(textRef.current, true);
      }
    };
    const onRejectGrammar = () => grammar.reject();
    window.addEventListener('ai-replace-selection', onReplace);
    window.addEventListener('ai-accept-autocomplete', onAcceptAutocomplete);
    window.addEventListener('ai-settings-changed', onAiSettings);
    window.addEventListener('ai-accept-grammar', onAcceptGrammar);
    window.addEventListener('ai-reject-grammar', onRejectGrammar);
    return () => {
      window.removeEventListener('ai-replace-selection', onReplace);
      window.removeEventListener('ai-accept-autocomplete', onAcceptAutocomplete);
      window.removeEventListener('ai-settings-changed', onAiSettings);
      window.removeEventListener('ai-accept-grammar', onAcceptGrammar);
      window.removeEventListener('ai-reject-grammar', onRejectGrammar);
    };
  }, [document?.role, grammar]);

  // Toggle presentation mode CSS class on body
  useEffect(() => {
    if (presentationMode) {
      globalThis.document.body.classList.add('presentation');
    } else {
      globalThis.document.body.classList.remove('presentation');
    }
  }, [presentationMode]);

  // Dispatch custom events for external listeners (e.g., RightRail)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('editor-online-users', { detail: onlineUsers }));
  }, [onlineUsers]);

  // Cursor flags are positioned during render, so a scroll or resize needs a
  // repaint to keep them aligned with the text they point at.
  useEffect(() => {
    if (remoteCursors.length === 0) return undefined;
    function repaint() {
      setCursorLayoutTick((tick) => tick + 1);
    }
    window.addEventListener('scroll', repaint, true);
    window.addEventListener('resize', repaint);
    return () => {
      window.removeEventListener('scroll', repaint, true);
      window.removeEventListener('resize', repaint);
    };
  }, [remoteCursors.length]);

  // Reports the real measured ack latency of the last CRDT operation.
  function reportSyncLatency(latencyMs) {
    lastLatencyRef.current = latencyMs;
    window.dispatchEvent(new CustomEvent('editor-sync-status', {
      detail: { latency: `${latencyMs}ms`, opsSynced: (opsSyncedRef.current += 1) }
    }));
  }

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      const meta = e.metaKey || e.ctrlKey;
      if (autocomplete.suggestion && e.key === 'Tab') {
        e.preventDefault();
        insertAutocomplete(autocomplete.suggestion);
        autocomplete.clear();
        return;
      }
      if (autocomplete.suggestion && e.key === 'Escape') {
        autocomplete.reject();
        return;
      }
      if (grammar.issue && e.key === 'Escape') {
        grammar.reject();
        return;
      }
      if (meta && e.key === ' ') {
        e.preventDefault();
        autocomplete.trigger(text, true);
        return;
      }
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      } else if (meta && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (meta && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        exportHtml();
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setShowShareModal(true);
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        runCommand('present');
      } else if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setShowShareModal(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [documentId, autocomplete.suggestion, autocomplete.trigger, autocomplete.clear, autocomplete.reject, grammar.issue, grammar.reject, text]);

  function applyOperation(operation, { broadcast = true } = {}) {
    if (!applyRemoteOperation(stateRef.current, operation)) return false;
    textRef.current = getCrdtText(stateRef.current);
    if (broadcast) {
      window.dispatchEvent(new CustomEvent('editor-crdt-op', { detail: operation }));
    }
    return true;
  }

  function refreshEditorStats() {
    setText(textRef.current);
  }

  function syncEditorSurface(force = false) {
    const editorSurface = editorSurfaceRef.current;
    if (!editorSurface) return;
    if (globalThis.document.activeElement === editorSurface && !force) return;
    const desired = formattedContentRef.current || textRef.current;
    if (editorSurface.innerHTML !== desired) {
      editorSurface.innerHTML = desired;
    }
  }

  function handleChange(event) {
    if (!document || !['admin', 'editor'].includes(document.role)) return;
    setError('');
    const editorSurface = event.currentTarget;
    const newText = editorSurface.innerText;
    // Clear any old text selection on paste/typing and publish the current
    // content immediately so AI actions cannot read the previous debounce tick.
    setSelectedText('');
    window.dispatchEvent(new CustomEvent('editor-selection', { detail: { text: '' } }));
    window.dispatchEvent(new CustomEvent('editor-document-text', { detail: { text: newText } }));
    pendingHtmlRef.current = editorSurface.innerHTML;

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

    // Keep React stats (word count etc.) and persisted HTML off the keystroke path
    if (!statsTimer.current) {
      statsTimer.current = setTimeout(() => {
        statsTimer.current = null;
        refreshEditorStats();
      }, 250);
    }
    if (!formattingTimer.current) {
      formattingTimer.current = setTimeout(() => {
        formattingTimer.current = null;
        const html = pendingHtmlRef.current;
        formattedContentRef.current = html;
        setFormattedContent(html);
        socketRef.current?.emit('formatting-update', { documentId, contentHtml: html });
      }, 400);
    }

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
    const sentAt = Date.now();
    socket.emit('crdt-operation', { documentId, operation }, (response) => {
      isSendingOperationRef.current = false;
      reportSyncLatency(Date.now() - sentAt);
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
      stateRef.current = createCrdtState(nextState);
      textRef.current = nextText;
      setText(nextText);
      formattedContentRef.current = result.document.formatted_content || '';
      setFormattedContent(result.document.formatted_content || '');
      syncEditorSurface(true);
      setError(`${message}. Document refreshed; please try that edit again.`);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function sendCursor(event) {
    const selection = window.getSelection();
    if (selection?.rangeCount) selectionRef.current = selection.getRangeAt(0).cloneRange();
    const selected = selection?.toString()?.trim() || '';
    setSelectedText(selected);
    window.dispatchEvent(new CustomEvent('editor-selection', { detail: { text: selected } }));
    syncFormatState();
    const offset = getCaretTextOffset(editorSurfaceRef.current);
    socketRef.current?.emit('cursor-move', {
      documentId,
      position: offset === null ? event.currentTarget.innerText.length : offset
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

  function replaceExactText(original, replacement) {
    if (readOnly || !original || !replacement || !editorSurfaceRef.current) return false;
    const root = editorSurfaceRef.current;
    const walker = globalThis.document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = node.nodeValue || '';
      const index = value.indexOf(original);
      if (index !== -1) {
        const selection = window.getSelection();
        const range = globalThis.document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + original.length);
        selection.removeAllRanges();
        selection.addRange(range);
        selectionRef.current = range.cloneRange();
        return replaceCurrentSelection(replacement);
      }
      node = walker.nextNode();
    }
    return false;
  }

  function commitEditorHtml() {
    const contentHtml = editorSurfaceRef.current?.innerHTML || '';
    pendingHtmlRef.current = contentHtml;
    setFormattedContent(contentHtml);
    socketRef.current?.emit('formatting-update', { documentId, contentHtml });
  }

  function applyBlockFormat(tag) {
    if (readOnly) return;
    restoreSelection();
    execFormat('formatBlock', tag);
    editorSurfaceRef.current?.focus();
    saveSelection();
    syncFormatState();
    commitEditorHtml();
  }

  function insertInlineHtml(html) {
    if (readOnly) return;
    restoreSelection();
    const applied = execFormat('insertHTML', html);
    if (!applied) {
      const selection = window.getSelection();
      if (selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const template = globalThis.document.createElement('template');
        template.innerHTML = html;
        range.insertNode(template.content);
      }
    }
    editorSurfaceRef.current?.focus();
    saveSelection();
    commitEditorHtml();
  }

  function insertPlainText(value) {
    if (readOnly) return;
    restoreSelection();
    execFormat('insertText', value);
    editorSurfaceRef.current?.focus();
    saveSelection();
    commitEditorHtml();
  }

  function replaceCurrentSelection(value) {
    const editorSurface = editorSurfaceRef.current;
    if (readOnly || !value || !editorSurface || !selectionRef.current) return false;
    editorSurface.focus();
    restoreSelection();
    try {
      const inserted = globalThis.document.execCommand('insertText', false, value);
      if (!inserted && selectionRef.current) {
        const selection = window.getSelection();
        if (!selection) return false;
        selection.removeAllRanges();
        selection.addRange(selectionRef.current);
        if (selection.getRangeAt(0).collapsed) return false;
        selection.deleteFromDocument();
        selection.getRangeAt(0).insertNode(globalThis.document.createTextNode(value));
      }
    } catch { return false; }
    saveSelection();
    setSelectedText('');
    window.dispatchEvent(new CustomEvent('editor-selection', { detail: { text: '' } }));
    editorSurface.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function replaceEntireDocument(value) {
    const editorSurface = editorSurfaceRef.current;
    if (readOnly || !value || !editorSurface) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    const range = globalThis.document.createRange();
    range.selectNodeContents(editorSurface);
    selection.removeAllRanges();
    selection.addRange(range);
    selectionRef.current = range.cloneRange();
    return replaceCurrentSelection(value);
  }

  function insertAutocomplete(value) {
    replaceCurrentSelection(value);
    setToast({ message: 'AI suggestion accepted', type: 'ok' });
  }

  function getSelectedElementStyles() {
    const editorSurface = editorSurfaceRef.current;
    const selection = window.getSelection();
    if (!editorSurface || !selection || !selection.rangeCount) return null;
    let node = selection.anchorNode;
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node && node !== editorSurface && node.parentElement) {
      if (node.style.fontSize || node.style.fontFamily || node.style.lineHeight) return node;
      node = node.parentElement;
    }
    if (editorSurface.style.fontSize || editorSurface.style.fontFamily || editorSurface.style.lineHeight) {
      return editorSurface;
    }
    return null;
  }

  function syncFormatState() {
    const editorSurface = editorSurfaceRef.current;
    if (!editorSurface) return;
    try {
      const doc = globalThis.document;
      const styledElement = getSelectedElementStyles();
      const selectionNode = doc.getSelection()?.anchorNode;
      const selectionElement = selectionNode?.nodeType === 1
        ? selectionNode
        : selectionNode?.parentElement;
      const blockElement = selectionElement?.closest('h1,h2,h3,blockquote,pre,li,p');
      const blockFormat = blockElement?.tagName?.toLowerCase() || 'p';
      let matchedFontSize = null;
      let matchedFontFamily = null;
      let currentLineHeight = '1.5';

      if (styledElement) {
        const computed = window.getComputedStyle(styledElement);
        const fs = styledElement.style.fontSize || computed.fontSize;
        if (fs) {
          const match = FONT_SIZES.find(s => s.value === fs);
          if (match) {
            matchedFontSize = match.value;
          } else {
            const px = parseFloat(fs);
            if (!isNaN(px)) {
              const closest = FONT_SIZES.reduce((prev, curr) =>
                Math.abs(parseFloat(curr.value) - px) < Math.abs(parseFloat(prev.value) - px) ? curr : prev
              );
              matchedFontSize = closest.value;
            }
          }
        }

        const ff = styledElement.style.fontFamily || computed.fontFamily;
        if (ff && ff !== 'inherit') {
          const match = FONT_FAMILIES.find(f =>
            f.value !== 'inherit' && ff.toLowerCase().includes(f.value.replace(/['"]/g, '').toLowerCase().split(',')[0])
          );
          if (match) matchedFontFamily = match.value;
        }

        const lh = styledElement.style.lineHeight || (computed.lineHeight !== 'normal' ? computed.lineHeight : null);
        if (lh) currentLineHeight = lh;
      }

      setFormatState((prev) => ({
        ...prev,
        bold: doc.queryCommandState('bold'),
        italic: doc.queryCommandState('italic'),
        underline: doc.queryCommandState('underline'),
        strike: doc.queryCommandState('strikeThrough'),
        superscript: doc.queryCommandState('superscript'),
        subscript: doc.queryCommandState('subscript'),
        unorderedList: doc.queryCommandState('insertUnorderedList'),
        orderedList: doc.queryCommandState('insertOrderedList'),
        blockFormat: ['li', 'ul', 'ol'].includes(blockFormat) ? 'p' : blockFormat,
        alignment: doc.queryCommandValue('justifyLeft') ? 'left'
          : doc.queryCommandValue('justifyCenter') ? 'center'
          : doc.queryCommandValue('justifyRight') ? 'right'
          : doc.queryCommandValue('justifyFull') ? 'justify' : 'left',
        fontSize: matchedFontSize || prev.fontSize,
        fontFamily: matchedFontFamily || prev.fontFamily,
        lineHeight: currentLineHeight,
        foreColor: doc.queryCommandValue('foreColor') || prev.foreColor,
        backColor: doc.queryCommandValue('hiliteColor') || doc.queryCommandValue('backColor') || prev.backColor
      }));
    } catch {}
  }

  function applyFormat(command, value = null) {
    if (readOnly) return;
    restoreSelection();
    const applied = execFormat(command, value);
    if (!applied && command === 'hiliteColor') {
      execFormat('backColor', value);
    }
    editorSurfaceRef.current?.focus();
    saveSelection();
    syncFormatState();
    const contentHtml = editorSurfaceRef.current?.innerHTML || '';
    pendingHtmlRef.current = contentHtml;
    setFormattedContent(contentHtml);
    socketRef.current?.emit('formatting-update', { documentId, contentHtml });
  }

  function applyAlignment(command) {
    if (readOnly) return;
    restoreSelection();
    applyFormat(command);
    editorSurfaceRef.current?.focus();
    saveSelection();
    syncFormatState();
    const contentHtml = editorSurfaceRef.current?.innerHTML || '';
    pendingHtmlRef.current = contentHtml;
    setFormattedContent(contentHtml);
    socketRef.current?.emit('formatting-update', { documentId, contentHtml });
  }

  function applyFontFamily(family) {
    if (readOnly) return;
    restoreSelection();
    const applied = setFontFamily(family);
    if (!applied) {
      execFormat('fontFamily', family);
    }
    editorSurfaceRef.current?.focus();
    saveSelection();
    syncFormatState();
    const contentHtml = editorSurfaceRef.current?.innerHTML || '';
    pendingHtmlRef.current = contentHtml;
    setFormattedContent(contentHtml);
    socketRef.current?.emit('formatting-update', { documentId, contentHtml });
  }

  function applyFontSize(sizeValue) {
    if (readOnly) return;
    restoreSelection();
    setFontSize(sizeValue);
    editorSurfaceRef.current?.focus();
    saveSelection();
    syncFormatState();
    const contentHtml = editorSurfaceRef.current?.innerHTML || '';
    pendingHtmlRef.current = contentHtml;
    setFormattedContent(contentHtml);
    socketRef.current?.emit('formatting-update', { documentId, contentHtml });
  }

  function applyLineHeight(height) {
    if (readOnly) return;
    restoreSelection();
    execFormat('lineHeight', height);
    setBlockStyle('lineHeight', height);
    editorSurfaceRef.current?.focus();
    saveSelection();
    syncFormatState();
    const contentHtml = editorSurfaceRef.current?.innerHTML || '';
    pendingHtmlRef.current = contentHtml;
    setFormattedContent(contentHtml);
    socketRef.current?.emit('formatting-update', { documentId, contentHtml });
  }

  function applyIndent(direction) {
    if (readOnly) return;
    restoreSelection();
    changeIndent(direction);
    editorSurfaceRef.current?.focus();
    saveSelection();
    const contentHtml = editorSurfaceRef.current?.innerHTML || '';
    pendingHtmlRef.current = contentHtml;
    setFormattedContent(contentHtml);
    socketRef.current?.emit('formatting-update', { documentId, contentHtml });
  }

  function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    setImageUploadError('');
    if (!file.type.startsWith('image/')) {
      setImageUploadError('Please select an image file (PNG, JPG, GIF, WebP, etc.)');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      const maxMB = MAX_IMAGE_SIZE / (1024 * 1024);
      setImageUploadError(`File size exceeds ${maxMB}MB limit.`);
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (readOnly) return;
      editorSurfaceRef.current?.focus();
      restoreSelection();
      const dataUrl = e.target.result;
      const inserted = insertImage(dataUrl, file.name);
      if (!inserted) {
        setImageUploadError('Could not insert the image. Place the cursor in the document and try again.');
        event.target.value = '';
        return;
      }
      const images = editorSurfaceRef.current?.querySelectorAll('img');
      const image = images?.[images.length - 1];
      if (image) {
        image.alt = file.name;
        image.title = file.name;
        image.style.maxWidth = '100%';
        image.style.height = 'auto';
        setSelectedImage({
          node: image,
          alt: image.alt,
          width: Math.round(image.getBoundingClientRect().width || image.naturalWidth),
          maxWidth: Math.max(120, editorSurfaceRef.current.clientWidth - 40),
          align: 'left'
        });
      }
      editorSurfaceRef.current?.focus();
      saveSelection();
      syncFormatState();
      const contentHtml = editorSurfaceRef.current?.innerHTML || '';
      setFormattedContent(contentHtml);
      socketRef.current?.emit('formatting-update', { documentId, contentHtml });
      event.target.value = '';
    };
    reader.onerror = () => {
      setImageUploadError('Failed to read image file.');
      event.target.value = '';
    };
    reader.readAsDataURL(file);
  }

  function handleCanvasClick(event) {
    sendCursor(event);
    const image = event.target.closest?.('img');
    if (!image) {
      setSelectedImage(null);
      return;
    }
    const surfaceWidth = editorSurfaceRef.current?.clientWidth || image.naturalWidth || 120;
    setSelectedImage({
      node: image,
      alt: image.alt || '',
      width: Math.round(image.getBoundingClientRect().width || image.naturalWidth || 120),
      maxWidth: Math.max(120, surfaceWidth - 40),
      align: image.style.marginLeft === 'auto' && image.style.marginRight === 'auto'
        ? 'center'
        : image.style.marginLeft === 'auto' ? 'right' : 'left'
    });
  }

  function resizeSelectedImage(width) {
    if (!selectedImage?.node?.isConnected) return;
    selectedImage.node.style.width = `${width}px`;
    selectedImage.node.style.height = 'auto';
    setSelectedImage((current) => ({ ...current, width: Number(width) }));
  }

  function alignSelectedImage(align) {
    if (!selectedImage?.node?.isConnected) return;
    const image = selectedImage.node;
    image.style.display = 'block';
    image.style.marginLeft = align === 'left' ? '0' : 'auto';
    image.style.marginRight = align === 'right' ? '0' : 'auto';
    setSelectedImage((current) => ({ ...current, align }));
    commitEditorHtml();
  }

  function updateSelectedImageAlt(alt) {
    if (!selectedImage?.node?.isConnected) return;
    selectedImage.node.alt = alt;
    selectedImage.node.title = alt;
    setSelectedImage((current) => ({ ...current, alt }));
  }

  function removeSelectedImage() {
    if (!selectedImage?.node?.isConnected) return;
    selectedImage.node.remove();
    setSelectedImage(null);
    commitEditorHtml();
  }

  useEffect(() => {
    if (!toast.message) return undefined;
    const timer = setTimeout(() => setToast({ message: '', type: 'ok' }), 2700);
    return () => clearTimeout(timer);
  }, [toast]);

  function exportHtml() {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${document?.title || 'Document'}</title></head><body><h1>${document?.title || ''}</h1>${editorSurfaceRef.current?.innerHTML || ''}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const a = globalThis.document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(document?.title || 'document').replace(/[^\w-]+/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
    setToast({ message: 'HTML export created', type: 'ok' });
  }

  function copyShareLink() {
    const link = `${globalThis.location.origin}/document/${documentId}`;
    if (globalThis.navigator?.clipboard) {
      globalThis.navigator.clipboard.writeText(link).catch(() => {});
    }
    setToast({ message: 'Share link copied', type: 'ok' });
    return link;
  }

  function findInDocument(query) {
    const q = (query || '').trim();
    if (!q) return;
    const target = editorSurfaceRef.current;
    if (target) {
      const haystack = target.innerText.toLowerCase();
      if (!haystack.includes(q.toLowerCase())) {
        setToast({ message: 'No match found', type: 'err' });
      } else {
        const count = haystack.split(q.toLowerCase()).length - 1;
        setToast({ message: `Found ${count} match${count === 1 ? '' : 'es'} for "${q}"`, type: 'ok' });
      }
    }
  }

  useEffect(() => {
    const target = editorSurfaceRef.current;
    const layer = cursorLayerRef.current;
    const query = searchQuery.trim();
    if (!target || !layer || !query) {
      setSearchHighlightRects([]);
      return undefined;
    }

    const walker = globalThis.document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let combinedText = '';
    let currentNode;
    while ((currentNode = walker.nextNode())) {
      const value = currentNode.nodeValue || '';
      textNodes.push({ node: currentNode, start: combinedText.length, end: combinedText.length + value.length });
      combinedText += value;
    }

    const lowerText = combinedText.toLocaleLowerCase();
    const lowerQuery = query.toLocaleLowerCase();
    const rects = [];
    const layerRect = layer.getBoundingClientRect();
    let searchFrom = 0;
    while (searchFrom <= lowerText.length - lowerQuery.length && rects.length < 300) {
      const matchAt = lowerText.indexOf(lowerQuery, searchFrom);
      if (matchAt < 0) break;
      const matchEnd = matchAt + lowerQuery.length;
      const startEntry = textNodes.find((entry) => matchAt >= entry.start && matchAt < entry.end);
      const endEntry = textNodes.find((entry) => matchEnd > entry.start && matchEnd <= entry.end);
      if (startEntry && endEntry) {
        const range = globalThis.document.createRange();
        range.setStart(startEntry.node, matchAt - startEntry.start);
        range.setEnd(endEntry.node, matchEnd - endEntry.start);
        for (const rect of range.getClientRects()) {
          if (rect.width && rect.height) {
            rects.push({
              left: rect.left - layerRect.left,
              top: rect.top - layerRect.top,
              width: rect.width,
              height: rect.height
            });
          }
        }
      }
      searchFrom = matchEnd;
    }

    setSearchHighlightRects(rects);
  }, [searchQuery, text, formattedContent]);

  function runCommand(command) {
    setShowCommandPalette(false);
    if (command === 'search') {
      const q = window.prompt('Find in document', searchQuery);
      if (q != null) findInDocument(q);
      return;
    }
    if (command === 'save') saveVersion();
    else if (command === 'share') setShowShareModal(true);
    else if (command === 'image') fileInputRef.current?.click();
    else if (command === 'present') {
      setPresentationMode((prev) => {
        const next = !prev;
        setToast({ message: next ? 'Presentation mode enabled' : 'Presentation mode disabled', type: 'ok' });
        return next;
      });
    } else if (command === 'export') exportHtml();
    else if (command === 'focus') {
      editorSurfaceRef.current?.focus();
      setToast({ message: 'Editor focused', type: 'ok' });
    }
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
    if (!versionMessage.trim()) {
      setShowVersionForm(true);
      setError('Add a short description before saving this version.');
      requestAnimationFrame(() => versionMessageRef.current?.focus());
      return;
    }
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
      setShowVersionForm(false);
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
            <p className="muted">This document may have been removed, or your account may no longer have access.</p>
            <Link className="primary-button compact" to="/dashboard">Return to your channels</Link>
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
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  return (
    <section className="editor-card">
      <div className="editor-head">
        <div className="editor-title-box">
          <div className="title-row">
            <input
              className="doc-title"
              value={document.title}
              disabled={readOnly}
              onChange={(e) => setDocument((prev) => ({ ...prev, title: e.target.value }))}
              onBlur={renameDocument}
              aria-label="Document title"
            />
          </div>
          <div className="meta-row">
            <span className="meta live">Live</span>
            <span className="meta role">{document.role}</span>
            <span className="meta">{saveSuccess ? 'Saved just now' : 'Synced'}</span>
            <span className="meta">{onlineUsers.length} collaborator{onlineUsers.length === 1 ? '' : 's'} online</span>
          </div>
        </div>
        <div className="editor-head-actions">
          <div className="collab-stack" title="View collaborators">
            {onlineUsers.slice(0, 4).map((u, i) => (
              <div key={u.id || i} className="avatar a-bh">
                {u.username ? u.username.substring(0, 2).toUpperCase() : 'BH'}
              </div>
            ))}
          </div>
          <button className="share-btn" onClick={() => setShowShareModal(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/></svg>
            Share
          </button>
          {!readOnly && (
            <button className="save-btn" disabled={isSavingVersion} onClick={() => { setShowVersionForm(true); setError(''); requestAnimationFrame(() => versionMessageRef.current?.focus()); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6"/></svg>
              {isSavingVersion ? 'Saving...' : 'Save version'}
            </button>
          )}
        </div>
      </div>

      {showVersionForm && !readOnly && (
        <form className="version-save-form" onSubmit={(event) => { event.preventDefault(); saveVersion(); }}>
          <div className="version-save-copy">
            <strong>Describe this version</strong>
            <span>This note will appear in Version History.</span>
          </div>
          <input
            ref={versionMessageRef}
            value={versionMessage}
            onChange={(event) => { setVersionMessage(event.target.value); if (error) setError(''); }}
            placeholder="For example: Added the project introduction"
            aria-label="Version description"
            maxLength={240}
            required
          />
          <div className="version-save-actions">
            <button type="button" className="version-cancel" onClick={() => { setShowVersionForm(false); setVersionMessage(''); setError(''); }}>Cancel</button>
            <button type="submit" className="save-btn" disabled={isSavingVersion || !versionMessage.trim()}>{isSavingVersion ? 'Saving…' : 'Save snapshot'}</button>
          </div>
        </form>
      )}

      {error && <div className="toast-banner toast-error" style={{ padding: '8px 16px', background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>⚠️ {error}</div>}
      {imageUploadError && <div className="image-upload-error" role="alert">{imageUploadError}<button type="button" onClick={() => setImageUploadError('')} aria-label="Dismiss image error">×</button></div>}

            <div className="search-box" style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '0 4px', marginBottom: '12px' }}>
        <div className="search" style={{ flex: 1, position: 'relative' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
          <input
            ref={searchInputRef}
            className="command-search"
            placeholder="Find in document..."
            value={searchQuery}
            onChange={(event) => { setSearchQuery(event.target.value); findInDocument(event.target.value); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); findInDocument(searchQuery); } }}
            style={{ width: '100%', padding: '8px 30px 8px 34px', border: 0, background: 'transparent', borderRadius: 0, color: '#fff', fontSize: '13px' }}
          />
          {searchQuery && (
            <button type="button" className="text-button" onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }}>x</button>
          )}
        </div>
      </div>

{!readOnly && (
        <div className="toolbar toolbar-enhanced" id="toolbar" role="toolbar" aria-label="Document formatting toolbar">
          <div className="tgroup">
            <button type="button" className="tbtn" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => { restoreSelection(); execFormat('undo'); saveSelection(); syncFormatState(); }} data-tip="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
            <button type="button" className="tbtn" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => { restoreSelection(); execFormat('redo'); saveSelection(); syncFormatState(); }} data-tip="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
          </div>
          <div className="tsep" />

          <div className="tgroup toolbar-selects">
            <select className={`select block-select ${formatState.blockFormat !== 'p' ? 'active' : ''}`} value={formatState.blockFormat} onMouseDown={saveSelection} onChange={(e) => applyBlockFormat(e.target.value)} data-tip="Text style" aria-label="Text style">
              <option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="blockquote">Quote</option><option value="pre">Code block</option>
            </select>
            <select className="select font-select" value={formatState.fontFamily} onMouseDown={saveSelection} onChange={(e) => applyFontFamily(e.target.value)} data-tip="Font family" aria-label="Font family">
              {FONT_FAMILIES.map((f) => (<option key={f.value} value={f.value}>{f.label}</option>))}
            </select>
            <select className="select size-select" value={formatState.fontSize} onMouseDown={saveSelection} onChange={(e) => applyFontSize(e.target.value)} data-tip="Font size" aria-label="Font size">
              {FONT_SIZES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
            </select>
          </div>

          <div className="tsep" />
          <div className="tgroup">
            <button type="button" className={`tbtn ${formatState.bold ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyFormat('bold')} data-tip="Bold" aria-label="Bold" aria-pressed={formatState.bold}><span className="texticon">B</span></button>
            <button type="button" className={`tbtn ${formatState.italic ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyFormat('italic')} data-tip="Italic" aria-label="Italic" aria-pressed={formatState.italic}><span className="texticon italic">I</span></button>
            <button type="button" className={`tbtn ${formatState.underline ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyFormat('underline')} data-tip="Underline" aria-label="Underline" aria-pressed={formatState.underline}><span className="texticon under">U</span></button>
            <button type="button" className={`tbtn ${formatState.strike ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyFormat('strikeThrough')} data-tip="Strikethrough" aria-label="Strikethrough" aria-pressed={formatState.strike}><span className="texticon strike">S</span></button>
          </div>

          <div className="tsep" />
          <div className="tgroup">
            <label className="tbtn color-tbtn" data-tip="Text color" aria-label="Text color" onMouseDown={saveSelection}>
              <span className="texticon">A</span><span className="color-line" style={{ backgroundColor: formatState.foreColor }} />
              <input type="color" value={formatState.foreColor} onChange={(e) => applyFormat('foreColor', e.target.value)} onClick={saveSelection} aria-label="Choose text color" />
            </label>
            <label className="tbtn color-tbtn" data-tip="Highlight color" aria-label="Highlight color" onMouseDown={saveSelection}>
              <span className="texticon">▰</span><span className="color-line highlight-line" style={{ backgroundColor: formatState.backColor }} />
              <input type="color" value={formatState.backColor} onChange={(e) => applyFormat('hiliteColor', e.target.value)} onClick={saveSelection} aria-label="Choose highlight color" />
            </label>
            <button type="button" className={`tbtn ${formatState.superscript ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyFormat('superscript')} data-tip="Superscript" aria-label="Superscript" aria-pressed={formatState.superscript}>x<sup>2</sup></button>
            <button type="button" className={`tbtn ${formatState.subscript ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyFormat('subscript')} data-tip="Subscript" aria-label="Subscript" aria-pressed={formatState.subscript}>x<sub>2</sub></button>
          </div>

          <div className="tsep" />
          <div className="tgroup">
            <button type="button" className={`tbtn ${formatState.alignment === 'left' ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyAlignment('justifyLeft')} data-tip="Align left" aria-label="Align left">≡</button>
            <button type="button" className={`tbtn ${formatState.alignment === 'center' ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyAlignment('justifyCenter')} data-tip="Align center" aria-label="Align center">≣</button>
            <button type="button" className={`tbtn ${formatState.alignment === 'right' ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyAlignment('justifyRight')} data-tip="Align right" aria-label="Align right">☰</button>
            <button type="button" className={`tbtn ${formatState.alignment === 'justify' ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyAlignment('justifyFull')} data-tip="Justify" aria-label="Justify">▤</button>
          </div>

          <div className="tsep" />
          <div className="tgroup">
            <button type="button" className={`tbtn ${formatState.unorderedList ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => { restoreSelection(); execFormat('insertUnorderedList'); saveSelection(); syncFormatState(); commitEditorHtml(); }} data-tip="Bulleted list" aria-label="Bulleted list" aria-pressed={formatState.unorderedList}>•☷</button>
            <button type="button" className={`tbtn ${formatState.orderedList ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => { restoreSelection(); execFormat('insertOrderedList'); saveSelection(); syncFormatState(); commitEditorHtml(); }} data-tip="Numbered list" aria-label="Numbered list" aria-pressed={formatState.orderedList}>1.2.</button>
            <button type="button" className="tbtn" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => insertPlainText('☐ ')} data-tip="Checklist" aria-label="Checklist">☐</button>
            <button type="button" className="tbtn" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyIndent('decrement')} data-tip="Decrease indent" aria-label="Decrease indent">⇤</button>
            <button type="button" className="tbtn" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyIndent('increment')} data-tip="Increase indent" aria-label="Increase indent">⇥</button>
          </div>

          <div className="tsep" />
          <div className="tgroup">
            <button type="button" className={`tbtn ${formatState.blockFormat === 'blockquote' ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyBlockFormat('blockquote')} data-tip="Blockquote" aria-label="Blockquote" aria-pressed={formatState.blockFormat === 'blockquote'}>❝</button>
            <button type="button" className={`tbtn ${formatState.blockFormat === 'pre' ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyBlockFormat('pre')} data-tip="Code block" aria-label="Code block" aria-pressed={formatState.blockFormat === 'pre'}>&lt;/&gt;</button>
            <button type="button" className="tbtn" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => execFormat('insertHorizontalRule') && commitEditorHtml()} data-tip="Horizontal rule" aria-label="Horizontal rule">―</button>
          </div>

          <div className="tsep" />
          <div className="tgroup">
            <button type="button" className="tbtn" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => { const url = window.prompt('Enter URL', 'https://example.com'); if (url) { restoreSelection(); execFormat('createLink', url); saveSelection(); commitEditorHtml(); } }} data-tip="Insert link" aria-label="Insert link">↗</button>
            <button type="button" className="tbtn" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => { restoreSelection(); execFormat('unlink'); saveSelection(); commitEditorHtml(); }} data-tip="Remove link" aria-label="Remove link">⊘</button>
            <button type="button" className="tbtn" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => insertInlineHtml('<table><tbody><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr></tbody></table><p></p>')} data-tip="Insert 3×3 table" aria-label="Insert table">▦</button>
          </div>

          <div className="tsep" />
          <div className="tgroup">
            <select className="select lh-select" value={formatState.lineHeight} onMouseDown={saveSelection} onChange={(e) => applyLineHeight(e.target.value)} data-tip="Line height" aria-label="Line height">
              {LINE_HEIGHTS.map((item) => (<option key={item.value} value={item.value}>{item.label}</option>))}
            </select>
            <button type="button" className="tbtn ai-toolbar-button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => window.dispatchEvent(new CustomEvent('ai-command', { detail: { action: 'rewrite', text: selectedText } }))} data-tip="AI rewrite" aria-label="AI rewrite">✦</button>
            <button type="button" className="tbtn image-btn" onMouseDown={(event) => { event.preventDefault(); saveSelection(); }} onClick={() => fileInputRef.current?.click()} data-tip="Insert image" aria-label="Insert image">▧</button>
            <input ref={fileInputRef} className="image-file-input" type="file" accept="image/*" onChange={handleImageUpload} aria-label="Choose an image to insert" />
            <button type="button" className="tbtn" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => applyFormat('removeFormat')} data-tip="Clear formatting" aria-label="Clear formatting">⌫</button>
          </div>
        </div>
      )}



      <div className="canvas-wrap">
        {selectedImage?.node?.isConnected && (
          <div className="image-edit-toolbar" role="group" aria-label="Selected image options">
            <strong>Image</strong>
            <label className="image-width-control">Width <span>{selectedImage.width}px</span>
              <input type="range" min="80" max={Math.max(80, selectedImage.maxWidth)} step="10" value={Math.min(selectedImage.width, selectedImage.maxWidth)} onChange={(event) => resizeSelectedImage(event.target.value)} onPointerUp={commitEditorHtml} onKeyUp={commitEditorHtml} onBlur={commitEditorHtml} aria-label="Resize image" />
            </label>
            <label className="image-alt-control">Alt text
              <input type="text" value={selectedImage.alt} maxLength={200} onChange={(event) => updateSelectedImageAlt(event.target.value)} onBlur={commitEditorHtml} aria-label="Image alt text" placeholder="Describe the image" />
            </label>
            <div className="image-align-controls" aria-label="Image alignment">
              {['left', 'center', 'right'].map((align) => <button key={align} type="button" className={selectedImage.align === align ? 'active' : ''} aria-pressed={selectedImage.align === align} onClick={() => alignSelectedImage(align)}>{align[0].toUpperCase() + align.slice(1)}</button>)}
            </div>
            <button type="button" className="image-remove-button" onClick={removeSelectedImage}>Remove</button>
          </div>
        )}
        <div className="doc-ruler"><i>1</i><i>2</i><i>3</i><i>4</i><i>5</i><i>6</i><i>7</i></div>
        <div className="canvas-layer" ref={cursorLayerRef}>
          <article
            ref={editorSurfaceRef}
            className="canvas"
            contentEditable={!readOnly}
            suppressContentEditableWarning
            onSelect={sendCursor}
            onClick={handleCanvasClick}
            onKeyUp={sendCursor}
            onInput={handleChange}
            role="textbox"
            aria-label="Document editor"
            data-placeholder={readOnly ? 'View-only access' : 'Start typing together in real-time...'}
          ></article>
          <div className="search-highlight-layer" aria-hidden="true">
            {searchHighlightRects.map((rect, index) => (
              <span
                className="search-highlight-hit"
                key={`${rect.left}-${rect.top}-${index}`}
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              />
            ))}
          </div>
          <div className="cursor-layer" aria-hidden="true">
            {remoteCursors.map((cursor) => {
              const rect = getOffsetRect(editorSurfaceRef.current, cursor.position);
              if (!rect) return null;
              const layerRect = cursorLayerRef.current.getBoundingClientRect();
              const left = rect.left - layerRect.left;
              const top = rect.top - layerRect.top;
              return (
                <div
                  key={cursor.userId}
                  className={`cursor-flag cursor-${cursor.colorIndex || 0}`}
                  style={{ left: `${left}px`, top: `${top}px`, background: cursor.color }}
                >
                  <span className="remote-label" style={{ background: cursor.color }}>{(cursor.username || '').slice(0, 2).toUpperCase()}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {aiEnabled && (
        <>
          {autocomplete.suggestion && (
            <div className="ai-ghost-panel" role="status" aria-live="polite">
              <div className="ai-ghost-label"><span className="ai-sparkle">✦</span> AI Suggest</div>
              <div className="ai-ghost-text">{autocomplete.suggestion}</div>
              <div className="ai-ghost-actions">
                <button type="button" onClick={() => { insertAutocomplete(autocomplete.suggestion); autocomplete.clear(); }}>✓ Accept</button>
                <button type="button" onClick={() => autocomplete.reject()}>✕ Reject</button>
                <span>Tab ↹ / Esc</span>
              </div>
            </div>
          )}
          <div className="ai-live-strip">
            <span className="ai-live-dot" />
            {grammar.isChecking ? 'AI is checking grammar…' : plagiarism.isChecking ? 'Scanning for similarity…' : `AI originality risk ${plagiarism.report.score || 0}%`}
            <button type="button" onClick={() => plagiarism.check(text)}>Run plagiarism check</button>
          </div>
        </>
      )}

      <AICommandBar disabled={!aiEnabled} selectedText={selectedText} />

      <footer className="bottom-bar">
        <div className="bottom-left">
          <div className="collab-stack">
            {onlineUsers.slice(0, 4).map((u, i) => (
              <div className="avatar a-bh" key={u.id || i} title={u.username}>
                {u.username ? u.username.substring(0, 2).toUpperCase() : 'BH'}
              </div>
            ))}
          </div>
          <span className="sync"><span className="sync-dot"></span><span>Synced to PostgreSQL</span></span>
          {typingUser && <span className="typing"><span className="dots"><i></i><i></i><i></i></span> {typingUser} is typing…</span>}
        </div>
        <div className="bottom-right">
          <span className="statline"><strong>{wordCount}</strong> words</span>
          <span className="statline"><strong>{charCount}</strong> characters</span>
          <span className="statline"><strong>{readTime}</strong> min read</span>
          <span className="kbd">⌘S</span>
        </div>
      </footer>

      {/* Share Modal */}
      {showShareModal && (
        <div className="overlay show" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', zIndex: 999 }} onClick={(e) => { if (e.target === e.currentTarget) setShowShareModal(false); }}>
          <div className="modal" style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '12px', padding: '24px', width: 'min(90vw, 420px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#fff' }}>Share this document</h3>
              <button style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', fontSize: '18px', cursor: 'pointer' }} onClick={() => setShowShareModal(false)}>×</button>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-3)', display: 'block', marginBottom: '6px' }}>Document Link</label>
              <input readOnly value={`${globalThis.location?.origin || ''}/document/${documentId}`} style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line)', borderRadius: '6px', color: '#fff', fontSize: '12px' }} />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary compact" onClick={() => setShowShareModal(false)}>Close</button>
              <button className="btn btn-primary compact" onClick={copyShareLink}>Copy Link</button>
            </div>
          </div>
        </div>
      )}

      {/* Command Palette Modal */}
      {showCommandPalette && (
        <div className="overlay show" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', zIndex: 999 }} onClick={(e) => { if (e.target === e.currentTarget) setShowCommandPalette(false); }}>
          <div className="modal" style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '12px', padding: '20px', width: 'min(90vw, 480px)' }}>
            <input
              autoFocus
              className="command-search"
              placeholder="Type a command (save, share, image, present, export, focus)..."
              value={commandSearch}
              style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)', borderRadius: '8px', color: '#fff', fontSize: '13px', outline: 'none', marginBottom: '12px' }}
              onChange={(e) => setCommandSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const cmd = commandSearch.toLowerCase().trim();
                  if (cmd) runCommand(cmd);
                }
              }}
            />
            <div className="command-list" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                { id: 'search', label: 'Find in document', key: 'F' },
                { id: 'save', label: 'Save version', key: '⌘S' },
                { id: 'share', label: 'Share document', key: '⌘⇧S' },
                { id: 'image', label: 'Insert image', key: '⌘⇧I' },
                { id: 'present', label: 'Presentation mode', key: '⌘⇧P' },
                { id: 'export', label: 'Export HTML', key: '⌘E' },
                { id: 'focus', label: 'Focus editor', key: '⌘L' }
              ]
                .filter(i => !commandSearch || i.label.toLowerCase().includes(commandSearch.toLowerCase()) || i.id.includes(commandSearch.toLowerCase()))
                .map((item) => (
                  <div
                    key={item.id}
                    onClick={() => runCommand(item.id)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', background: 'rgba(255,255,255,0.01)', border: '1px solid transparent', color: 'var(--text-2)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#fff'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.01)'; e.currentTarget.style.color = 'var(--text-2)'; }}
                  >
                    <span style={{ fontSize: '13px' }}>{item.label}</span>
                    <span style={{ font: '700 10px var(--mono)', color: 'var(--text-3)', border: '1px solid var(--line)', padding: '2px 5px', borderRadius: '4px' }}>{item.key}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast.message && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 1000, background: toast.type === 'err' ? 'rgba(239,68,68,0.9)' : 'rgba(16,185,129,0.9)', color: '#fff', padding: '10px 18px', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.3)', font: '600 13px var(--font-sans)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>{toast.type === 'err' ? '⚠️' : '✨'}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </section>
  );
}

import { query } from './db.js';
import { verifyToken } from './auth.js';
import { getMembership } from './channels.js';
import { getActiveCRDT, hasActiveCRDT } from './crdt/crdtStore.js';
import { isValidOperation } from './crdt/crdtOperations.js';

const documentUsers = new Map();
let socketServer;

function roomName(documentId) {
  return `document-${documentId}`;
}

function getUsers(documentId) {
  return Array.from(documentUsers.get(String(documentId))?.values() || []);
}

function addUser(documentId, socket) {
  const key = String(documentId);
  if (!documentUsers.has(key)) {
    documentUsers.set(key, new Map());
  }
  documentUsers.get(key).set(socket.id, {
    id: socket.user.id,
    username: socket.user.username,
    role: socket.data.roles[key]
  });
}

function removeUser(documentId, socketId) {
  const users = documentUsers.get(String(documentId));
  if (!users) return;
  users.delete(socketId);
  if (users.size === 0) documentUsers.delete(String(documentId));
}

const MAX_CONTENT_HTML_SIZE = 5 * 1024 * 1024;
const PERSIST_DEBOUNCE_MS = 1200;

const dirtyContents = new Map();
const formattingBuckets = new Map();

function scheduleDocumentContent(documentId) {
  const key = String(documentId);
  if (dirtyContents.has(key)) return;
  dirtyContents.set(key, {
    documentId,
    timer: setTimeout(() => flushDocumentContent(key), PERSIST_DEBOUNCE_MS)
  });
}

function flushDocumentContent(key) {
  const entry = dirtyContents.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  dirtyContents.delete(key);
  const crdt = getActiveCRDT(entry.documentId, {});
  crdt.compact();
  return query(
    'UPDATE documents SET current_content = $1, crdt_state = $2, updated_at = NOW() WHERE id = $3',
    [crdt.getText(), crdt.getState(), entry.documentId]
  ).catch((error) => {
    console.error('Failed to persist document content', entry.documentId, error);
  });
}

export function flushAllDocumentContent() {
  return Promise.all(Array.from(dirtyContents.keys()).map((key) => flushDocumentContent(key)));
}

function flushFormatting(bucketKey) {
  const bucket = formattingBuckets.get(bucketKey);
  if (!bucket || bucket.inFlight) return;

  const { socket, documentId, contentHtml } = bucket;
  bucket.pending = false;
  bucket.inFlight = true;
  query('UPDATE documents SET formatted_content = $1, updated_at = NOW() WHERE id = $2', [contentHtml, documentId])
    .then(() => {
      socket.to(roomName(documentId)).emit('formatting-update', { documentId, contentHtml });
    })
    .catch(() => {
      socket.emit('error', { message: 'Unable to save formatting' });
    })
    .finally(() => {
      bucket.inFlight = false;
      if (!bucket.pending) {
        clearTimeout(bucket.timer);
        formattingBuckets.delete(bucketKey);
        return;
      }
      flushFormatting(bucketKey);
    });
}

function queueFormatting(socket, documentId, contentHtml) {
  const bucketKey = `${String(documentId)}:${socket.id}`;
  let bucket = formattingBuckets.get(bucketKey);
  if (!bucket) {
    bucket = { socket, documentId, contentHtml, inFlight: false, pending: false, timer: null };
    formattingBuckets.set(bucketKey, bucket);
  } else {
    bucket.contentHtml = contentHtml;
    if (bucket.inFlight) bucket.pending = true;
  }
  if (!bucket.inFlight) flushFormatting(bucketKey);
}

export function setupSocketHandlers(io) {
  socketServer = io;
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Please login first'));
      socket.user = verifyToken(token);
      socket.data.roles = {};
      socket.data.documents = new Set();
      return next();
    } catch {
      return next(new Error('Please login first'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join-document', async ({ documentId }) => {
      try {
        const documentResult = await query('SELECT * FROM documents WHERE id = $1', [documentId]);
        const document = documentResult.rows[0];
        if (!document) return socket.emit('error', { message: 'Document not found' });

        const membership = await getMembership(document.channel_id, socket.user.id);
        if (!membership) return socket.emit('error', { message: 'You are not a member of this channel' });

        const crdt = getActiveCRDT(document.id, document.crdt_state);
        const key = String(document.id);
        socket.data.roles[key] = membership.role;
        socket.data.documents.add(key);
        socket.join(roomName(document.id));
        addUser(document.id, socket);

        socket.emit('initial-document', {
          documentId: document.id,
          title: document.title,
          state: crdt.getState(),
          formattedContent: document.formatted_content || '',
          content: crdt.getText(),
          role: membership.role,
          users: getUsers(document.id)
        });
        socket.to(roomName(document.id)).emit('user-joined', {
          documentId: document.id,
          user: { id: socket.user.id, username: socket.user.username, role: membership.role },
          users: getUsers(document.id)
        });
      } catch {
        socket.emit('error', { message: 'Unable to join document' });
      }
    });

    socket.on('leave-document', ({ documentId }) => {
      leaveDocument(socket, documentId, io);
    });

    socket.on('crdt-operation', async ({ documentId, operation }, acknowledge) => {
      const respond = typeof acknowledge === 'function' ? acknowledge : () => {};
      const key = String(documentId);
      if (!socket.data.documents.has(key)) {
        respond({ ok: false, message: 'Join the document first' });
        return socket.emit('error', { message: 'Join the document first' });
      }
      if (!['admin', 'editor'].includes(socket.data.roles[key])) {
        respond({ ok: false, message: 'Viewers cannot modify documents' });
        return socket.emit('error', { message: 'Viewers cannot modify documents' });
      }
      if (!isValidOperation(operation)) {
        respond({ ok: false, message: 'Invalid CRDT operation' });
        return socket.emit('error', { message: 'Invalid CRDT operation' });
      }

      try {
        let crdt = hasActiveCRDT(documentId) ? getActiveCRDT(documentId, {}) : null;
        if (!crdt) {
          const documentResult = await query('SELECT crdt_state FROM documents WHERE id = $1', [documentId]);
          const document = documentResult.rows[0];
          if (!document) {
            respond({ ok: false, message: 'Document not found' });
            return socket.emit('error', { message: 'Document not found' });
          }
          crdt = getActiveCRDT(documentId, document.crdt_state);
        }

        const changed = crdt.applyOperation(operation);
        if (!changed && !crdt.hasOperation(operation.id)) {
          if (operation.type === 'delete') {
            respond({ ok: true, ignored: true });
            return;
          }
          respond({ ok: false, message: 'Operation dependency is not available' });
          return socket.emit('error', { message: 'Operation dependency is not available' });
        }

        socket.to(roomName(documentId)).emit('crdt-operation', { documentId, operation });
        query(
          `INSERT INTO document_operations (document_id, operation_id, user_id, operation_type, operation_data)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (document_id, operation_id) DO NOTHING`,
          [documentId, operation.id, socket.user.id, operation.type, operation]
        ).catch(() => {});
        scheduleDocumentContent(documentId);
        respond({ ok: true });
      } catch {
        respond({ ok: false, message: 'Unable to apply CRDT operation' });
        socket.emit('error', { message: 'Unable to apply CRDT operation' });
      }
    });

    socket.on('formatting-update', ({ documentId, contentHtml }) => {
      const key = String(documentId);
      if (!socket.data.documents.has(key) || !['admin', 'editor'].includes(socket.data.roles[key])) return;
      if (typeof contentHtml !== 'string' || contentHtml.length > MAX_CONTENT_HTML_SIZE) return;
      queueFormatting(socket, documentId, contentHtml);
    });

    socket.on('cursor-move', ({ documentId, position }) => {
      if (socket.data.documents.has(String(documentId))) {
        socket.to(roomName(documentId)).emit('cursor-move', {
          documentId,
          userId: socket.user.id,
          username: socket.user.username,
          position
        });
      }
    });

    socket.on('typing-start', ({ documentId }) => {
      if (socket.data.documents.has(String(documentId))) {
        socket.to(roomName(documentId)).emit('user-typing', {
          documentId,
          userId: socket.user.id,
          username: socket.user.username
        });
      }
    });

    socket.on('typing-stop', ({ documentId }) => {
      if (socket.data.documents.has(String(documentId))) {
        socket.to(roomName(documentId)).emit('user-stopped-typing', {
          documentId,
          userId: socket.user.id
        });
      }
    });

    socket.on('disconnect', () => {
      for (const documentId of socket.data.documents) {
        leaveDocument(socket, documentId, io);
      }
    });
  });
}

export function broadcastDocumentOperation(documentId, operation) {
  socketServer?.to(roomName(documentId)).emit('crdt-operation', { documentId, operation });
}

export function broadcastDocumentRestored(documentId, payload) {
  socketServer?.to(roomName(documentId)).emit('document-restored', { documentId, ...payload });
}

function leaveDocument(socket, documentId, io) {
  const key = String(documentId);
  if (!socket.data.documents.has(key)) return;
  socket.leave(roomName(documentId));
  socket.data.documents.delete(key);
  removeUser(documentId, socket.id);
  io.to(roomName(documentId)).emit('user-left', {
    documentId,
    userId: socket.user.id,
    users: getUsers(documentId)
  });
}

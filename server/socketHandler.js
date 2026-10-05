import { query } from './db.js';
import { verifyToken } from './auth.js';
import { getMembership } from './channels.js';
import { getActiveCRDT } from './crdt/crdtStore.js';
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

    socket.on('crdt-operation', async ({ documentId, operation }) => {
      const key = String(documentId);
      if (!socket.data.documents.has(key)) return socket.emit('error', { message: 'Join the document first' });
      if (!['admin', 'editor'].includes(socket.data.roles[key])) {
        return socket.emit('error', { message: 'Viewers cannot modify documents' });
      }
      if (!isValidOperation(operation)) {
        return socket.emit('error', { message: 'Invalid CRDT operation' });
      }

      try {
        const documentResult = await query('SELECT * FROM documents WHERE id = $1', [documentId]);
        const document = documentResult.rows[0];
        const crdt = getActiveCRDT(documentId, document.crdt_state);
        const changed = crdt.applyOperation(operation);
        if (!changed && !crdt.hasOperation(operation.id)) {
          return socket.emit('error', { message: 'Operation dependency is not available' });
        }

        await query(
          `INSERT INTO document_operations (document_id, operation_id, user_id, operation_type, operation_data)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (document_id, operation_id) DO NOTHING`,
          [documentId, operation.id, socket.user.id, operation.type, operation]
        );
        await query(
          `UPDATE documents SET current_content = $1, crdt_state = $2, updated_at = NOW() WHERE id = $3`,
          [crdt.getText(), crdt.getState(), documentId]
        );
        socket.to(roomName(documentId)).emit('crdt-operation', { documentId, operation });
      } catch {
        socket.emit('error', { message: 'Unable to apply CRDT operation' });
      }
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

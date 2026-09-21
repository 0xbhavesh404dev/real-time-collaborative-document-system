import express from 'express';
import { query } from './db.js';
import { requireAuth } from './auth.js';
import { canEdit, findDocument } from './documents.js';
import { getActiveCRDT } from './crdt/crdtStore.js';
import { broadcastDocumentOperation } from './socketHandler.js';

const router = express.Router();
router.use(requireAuth);

router.post('/documents/:id/versions', async (req, res) => {
  const { message, content } = req.body;
  if (!message?.trim()) {
    return res.status(400).json({ message: 'Version message is required' });
  }
  try {
    const document = await findDocument(req.params.id, req.user.id);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    if (!canEdit(document.role)) {
      return res.status(403).json({ message: 'You do not have permission to save a version' });
    }
    const result = await query(
      `INSERT INTO versions (document_id, user_id, content_snapshot, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, document_id, user_id, content_snapshot, message, created_at`,
      [req.params.id, req.user.id, content ?? document.current_content, message.trim()]
    );
    return res.status(201).json({ version: result.rows[0] });
  } catch {
    return res.status(500).json({ message: 'Unable to save version' });
  }
});

router.get('/documents/:id/versions', async (req, res) => {
  try {
    const document = await findDocument(req.params.id, req.user.id);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    const result = await query(
      `SELECT v.id, v.document_id, v.user_id, v.content_snapshot, v.message, v.created_at, u.username
       FROM versions v JOIN users u ON u.id = v.user_id
       WHERE v.document_id = $1 ORDER BY v.created_at DESC`,
      [req.params.id]
    );
    return res.json({ versions: result.rows });
  } catch {
    return res.status(500).json({ message: 'Unable to load version history' });
  }
});

router.get('/versions/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT v.*, u.username FROM versions v JOIN users u ON u.id = v.user_id
       JOIN documents d ON d.id = v.document_id
       JOIN channel_members cm ON cm.channel_id = d.channel_id
       WHERE v.id = $1 AND cm.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Version not found' });
    }
    return res.json({ version: result.rows[0] });
  } catch {
    return res.status(500).json({ message: 'Unable to load version' });
  }
});

router.post('/versions/:id/restore', async (req, res) => {
  try {
    const versionResult = await query(
      `SELECT v.*, d.channel_id FROM versions v JOIN documents d ON d.id = v.document_id WHERE v.id = $1`,
      [req.params.id]
    );
    const version = versionResult.rows[0];
    if (!version) {
      return res.status(404).json({ message: 'Version not found' });
    }
    const document = await findDocument(version.document_id, req.user.id);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    if (!canEdit(document.role)) {
      return res.status(403).json({ message: 'You do not have permission to restore a version' });
    }
    const crdt = getActiveCRDT(version.document_id, document.crdt_state);
    const visibleNodes = crdt.getVisibleNodes();
    const operations = visibleNodes.map((node) => ({ type: 'delete', id: node.id }));
    let leftId = visibleNodes.at(-1)?.id || 'HEAD';
    const restoreClientId = `restore:${req.user.id}:${Date.now()}`;
    for (const [index, value] of [...version.content_snapshot].entries()) {
      const operation = {
        type: 'insert',
        id: `${restoreClientId}:${index + 1}`,
        leftId,
        value
      };
      operations.push(operation);
      leftId = operation.id;
    }
    operations.forEach((operation) => crdt.applyOperation(operation));
    await query(
      `INSERT INTO document_operations (document_id, operation_id, user_id, operation_type, operation_data)
       SELECT $1, operation->>'id', $2, operation->>'type', operation
       FROM jsonb_array_elements($3::jsonb) AS operation
       ON CONFLICT (document_id, operation_id) DO NOTHING`,
      [version.document_id, req.user.id, JSON.stringify(operations)]
    );
    await query(
      `UPDATE documents SET current_content = $1, crdt_state = $2, updated_at = NOW() WHERE id = $3`,
      [crdt.getText(), crdt.getState(), version.document_id]
    );
    operations.forEach((operation) => broadcastDocumentOperation(version.document_id, operation));
    const result = await query(
      `INSERT INTO versions (document_id, user_id, content_snapshot, message)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [version.document_id, req.user.id, version.content_snapshot, `Restored from version ${version.id}`]
    );
    return res.json({ version: result.rows[0], restoredContent: version.content_snapshot });
  } catch {
    return res.status(500).json({ message: 'Unable to restore version' });
  }
});

export default router;

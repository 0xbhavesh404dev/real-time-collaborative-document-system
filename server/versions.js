import express from 'express';
import { query } from './db.js';
import { requireAuth } from './auth.js';
import { canEdit, findDocument } from './documents.js';
import { getActiveCRDT } from './crdt/crdtStore.js';
import { broadcastDocumentOperation, broadcastDocumentRestored } from './socketHandler.js';
import { TextCRDT } from './crdt/TextCRDT.js';

const router = express.Router();
router.use(requireAuth);

router.post('/documents/:id/versions', async (req, res) => {
  const { message, content, contentHtml } = req.body;
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
      `INSERT INTO versions (document_id, user_id, content_snapshot, content_html, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, document_id, user_id, content_snapshot, content_html, message, created_at`,
      [req.params.id, req.user.id, content ?? document.current_content, contentHtml ?? document.formatted_content, message.trim()]
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

    // Build fresh CRDT for the restored snapshot
    const crdt = new TextCRDT();
    let leftId = 'HEAD';
    const restoreClientId = `restore:${req.user.id}:${Date.now()}`;
    for (const [index, value] of [...version.content_snapshot].entries()) {
      const operation = {
        type: 'insert',
        id: `${restoreClientId}:${index + 1}`,
        leftId,
        value
      };
      crdt.applyOperation(operation);
      leftId = operation.id;
    }

    // Update active memory CRDT
    const activeCrdt = getActiveCRDT(version.document_id, document.crdt_state);
    activeCrdt.loadState(crdt.getState());

    // Update DB
    await query(
      `UPDATE documents SET current_content = $1, formatted_content = $2, crdt_state = $3, updated_at = NOW() WHERE id = $4`,
      [crdt.getText(), version.content_html || '', crdt.getState(), version.document_id]
    );

    // Save version history record
    const result = await query(
      `INSERT INTO versions (document_id, user_id, content_snapshot, content_html, message)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [version.document_id, req.user.id, version.content_snapshot, version.content_html || '', `Restored from version ${version.id}`]
    );

    // Broadcast to all active clients in document room
    broadcastDocumentRestored(version.document_id, {
      title: document.title,
      content: crdt.getText(),
      contentHtml: version.content_html || '',
      state: crdt.getState(),
      version: result.rows[0]
    });

    return res.json({ version: result.rows[0], restoredContent: version.content_snapshot, restoredHtml: version.content_html || '', crdtState: crdt.getState() });
  } catch (err) {
    console.error('Error restoring version:', err);
    return res.status(500).json({ message: 'Unable to restore version' });
  }
});

export default router;

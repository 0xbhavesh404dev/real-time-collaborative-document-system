import express from 'express';
import { query } from './db.js';
import { requireAuth } from './auth.js';
import { getMembership } from './channels.js';
import { forgetDocument } from './socketHandler.js';

const router = express.Router();
router.use(requireAuth);

function canEdit(role) {
  return role === 'admin' || role === 'editor';
}

async function findDocument(documentId, userId) {
  const result = await query(
    `SELECT d.*, cm.role FROM documents d
     JOIN channel_members cm ON cm.channel_id = d.channel_id
     WHERE d.id = $1 AND cm.user_id = $2`,
    [documentId, userId]
  );
  return result.rows[0] || null;
}

router.get('/channels/:channelId/documents', async (req, res) => {
  try {
    const membership = await getMembership(req.params.channelId, req.user.id);
    if (!membership) {
      return res.status(403).json({ message: 'You are not a member of this channel' });
    }
    const result = await query(
      `SELECT id, channel_id, title, created_by, created_at, updated_at
       FROM documents WHERE channel_id = $1 ORDER BY updated_at DESC`,
      [req.params.channelId]
    );
    return res.json({ documents: result.rows });
  } catch {
    return res.status(500).json({ message: 'Unable to load documents' });
  }
});

router.post('/channels/:channelId/documents', async (req, res) => {
  const { title } = req.body;
  try {
    const membership = await getMembership(req.params.channelId, req.user.id);
    if (!membership) {
      return res.status(403).json({ message: 'You are not a member of this channel' });
    }
    if (!canEdit(membership.role)) {
      return res.status(403).json({ message: 'You do not have permission to create documents' });
    }
    if (!title?.trim()) {
      return res.status(400).json({ message: 'Document title is required' });
    }
    const result = await query(
      `INSERT INTO documents (channel_id, title, created_by)
       VALUES ($1, $2, $3) RETURNING id, channel_id, title, current_content, formatted_content, crdt_state, created_by, created_at, updated_at`,
      [req.params.channelId, title.trim(), req.user.id]
    );
    return res.status(201).json({ document: result.rows[0] });
  } catch {
    return res.status(500).json({ message: 'Unable to create document' });
  }
});

router.get('/documents/:id', async (req, res) => {
  try {
    const document = await findDocument(req.params.id, req.user.id);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    return res.json({ document });
  } catch {
    return res.status(500).json({ message: 'Unable to load document' });
  }
});

router.patch('/documents/:id', async (req, res) => {
  const { title } = req.body;
  try {
    const document = await findDocument(req.params.id, req.user.id);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    if (!canEdit(document.role)) {
      return res.status(403).json({ message: 'You do not have permission to edit' });
    }
    if (!title?.trim()) {
      return res.status(400).json({ message: 'Document title is required' });
    }
    const result = await query(
      `UPDATE documents SET title = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [title.trim(), req.params.id]
    );
    return res.json({ document: result.rows[0] });
  } catch {
    return res.status(500).json({ message: 'Unable to rename document' });
  }
});

router.delete('/documents/:id', async (req, res) => {
  try {
    const document = await findDocument(req.params.id, req.user.id);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    if (!canEdit(document.role)) {
      return res.status(403).json({ message: 'You do not have permission to delete this document' });
    }

    const result = await query('DELETE FROM documents WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }
    forgetDocument(req.params.id);
    return res.json({ message: 'Document deleted' });
  } catch {
    return res.status(500).json({ message: 'Unable to delete document' });
  }
});

export { canEdit, findDocument };
export default router;

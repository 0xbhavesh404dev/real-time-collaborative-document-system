import express from 'express';
import { query } from './db.js';
import { requireAuth } from './auth.js';

const router = express.Router();
router.use(requireAuth);

export async function getMembership(channelId, userId) {
  const result = await query(
    `SELECT cm.role, cm.channel_id, c.owner_id
     FROM channel_members cm
     JOIN channels c ON c.id = cm.channel_id
     WHERE cm.channel_id = $1 AND cm.user_id = $2`,
    [channelId, userId]
  );
  return result.rows[0] || null;
}

export async function requireMembership(req, res, next) {
  try {
    const membership = await getMembership(req.params.id || req.params.channelId, req.user.id);
    if (!membership) {
      return res.status(403).json({ message: 'You are not a member of this channel' });
    }
    req.membership = membership;
    return next();
  } catch {
    return res.status(500).json({ message: 'Unable to check channel membership' });
  }
}

function requireAdmin(req, res, next) {
  if (req.membership.role !== 'admin') {
    return res.status(403).json({ message: 'Only channel admins can perform this action' });
  }
  return next();
}

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT c.id, c.name, c.description, c.owner_id, c.created_at, cm.role
       FROM channels c
       JOIN channel_members cm ON cm.channel_id = c.id
       WHERE cm.user_id = $1 ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    return res.json({ channels: result.rows });
  } catch {
    return res.status(500).json({ message: 'Unable to load channels' });
  }
});

router.post('/', async (req, res) => {
  const { name, description = '' } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ message: 'Channel name is required' });
  }

  const client = await (await import('./db.js')).pool.connect();
  try {
    await client.query('BEGIN');
    const channelResult = await client.query(
      `INSERT INTO channels (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *`,
      [name.trim(), description.trim(), req.user.id]
    );
    const channel = channelResult.rows[0];
    await client.query(
      `INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [channel.id, req.user.id]
    );
    await client.query('COMMIT');
    return res.status(201).json({ channel: { ...channel, role: 'admin' } });
  } catch {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Unable to create channel' });
  } finally {
    client.release();
  }
});

router.post('/join-by-name', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ message: 'Channel name is required' });
  }
  try {
    const channelResult = await query(
      'SELECT id FROM channels WHERE LOWER(name) = LOWER($1) ORDER BY id DESC LIMIT 1',
      [name.trim()]
    );
    if (channelResult.rowCount === 0) {
      return res.status(404).json({ message: 'Channel not found. Check the channel name.' });
    }
    const channelId = channelResult.rows[0].id;
    await query(
      `INSERT INTO channel_members (channel_id, user_id, role)
       VALUES ($1, $2, 'editor') ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [channelId, req.user.id]
    );
    return res.json({ message: 'Joined channel', channelId });
  } catch {
    return res.status(500).json({ message: 'Unable to join channel' });
  }
});

router.get('/:id', requireMembership, async (req, res) => {
  try {
    const result = await query('SELECT * FROM channels WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Channel not found' });
    }
    return res.json({ channel: result.rows[0], role: req.membership.role });
  } catch {
    return res.status(500).json({ message: 'Unable to load channel' });
  }
});

router.post('/:id/join', async (req, res) => {
  try {
    const channel = await query('SELECT id FROM channels WHERE id = $1', [req.params.id]);
    if (channel.rowCount === 0) {
      return res.status(404).json({ message: 'Channel not found' });
    }
    await query(
      `INSERT INTO channel_members (channel_id, user_id, role)
       VALUES ($1, $2, 'editor') ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [req.params.id, req.user.id]
    );
    return res.json({ message: 'Joined channel' });
  } catch {
    return res.status(500).json({ message: 'Unable to join channel' });
  }
});

router.post('/:id/leave', requireMembership, async (req, res) => {
  if (req.membership.owner_id === req.user.id) {
    return res.status(400).json({ message: 'The channel owner cannot leave the channel' });
  }
  try {
    await query('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    return res.json({ message: 'Left channel' });
  } catch {
    return res.status(500).json({ message: 'Unable to leave channel' });
  }
});

router.get('/:id/members', requireMembership, async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.email, cm.role, cm.joined_at
       FROM channel_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.channel_id = $1 ORDER BY u.username`,
      [req.params.id]
    );
    return res.json({ members: result.rows });
  } catch {
    return res.status(500).json({ message: 'Unable to load members' });
  }
});

router.post('/:id/invite', requireMembership, requireAdmin, async (req, res) => {
  const { inviteeEmail, role = 'viewer' } = req.body;
  if (!inviteeEmail || !['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ message: 'Valid email and role are required' });
  }
  try {
    const result = await query(
      `INSERT INTO invitations (channel_id, inviter_id, invitee_email, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, req.user.id, inviteeEmail.toLowerCase().trim(), role]
    );
    return res.status(201).json({ invitation: result.rows[0] });
  } catch {
    return res.status(500).json({ message: 'Unable to create invitation' });
  }
});

router.delete('/:id/members/:userId', requireMembership, requireAdmin, async (req, res) => {
  if (Number(req.params.userId) === req.membership.owner_id) {
    return res.status(400).json({ message: 'The channel owner cannot be removed' });
  }
  try {
    await query('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
    return res.json({ message: 'Member removed' });
  } catch {
    return res.status(500).json({ message: 'Unable to remove member' });
  }
});

router.patch('/:id/members/:userId', requireMembership, requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ message: 'Invalid member role' });
  }
  if (Number(req.params.userId) === req.membership.owner_id && role !== 'admin') {
    return res.status(400).json({ message: 'The channel owner must remain an admin' });
  }
  try {
    const result = await query(
      `UPDATE channel_members SET role = $1 WHERE channel_id = $2 AND user_id = $3
       RETURNING channel_id, user_id, role`,
      [role, req.params.id, req.params.userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Member not found' });
    }
    return res.json({ member: result.rows[0] });
  } catch {
    return res.status(500).json({ message: 'Unable to update member role' });
  }
});

router.delete('/:id', requireMembership, requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM channels WHERE id = $1', [req.params.id]);
    return res.json({ message: 'Channel deleted' });
  } catch {
    return res.status(500).json({ message: 'Unable to delete channel' });
  }
});

export default router;

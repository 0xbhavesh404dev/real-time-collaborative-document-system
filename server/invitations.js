import express from 'express';
import { query, pool } from './db.js';
import { requireAuth } from './auth.js';

const router = express.Router();
router.use(requireAuth);

// Invitations addressed to the signed-in user's email that they can still act on.
router.get('/pending', async (req, res) => {
  try {
    const result = await query(
      `SELECT i.id, i.channel_id, i.role, i.status, i.created_at,
              c.name AS channel_name, u.username AS inviter_username
       FROM invitations i
       JOIN channels c ON c.id = i.channel_id
       JOIN users u ON u.id = i.inviter_id
       WHERE LOWER(i.invitee_email) = LOWER($1) AND i.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM channel_members cm WHERE cm.channel_id = i.channel_id AND cm.user_id = $2
         )
       ORDER BY i.created_at DESC`,
      [req.user.email, req.user.id]
    );
    return res.json({ invitations: result.rows });
  } catch {
    return res.status(500).json({ message: 'Unable to load invitations' });
  }
});

// Invitation history for one channel, visible to that channel's admins.
router.get('/channel/:channelId', async (req, res) => {
  try {
    const membership = await query(
      'SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [req.params.channelId, req.user.id]
    );
    if (membership.rows[0]?.role !== 'admin') {
      return res.status(403).json({ message: 'Only channel admins can view invitations' });
    }
    const result = await query(
      `SELECT i.id, i.invitee_email, i.role, i.status, i.created_at, u.username AS inviter_username
       FROM invitations i JOIN users u ON u.id = i.inviter_id
       WHERE i.channel_id = $1 ORDER BY i.created_at DESC LIMIT 50`,
      [req.params.channelId]
    );
    return res.json({ invitations: result.rows });
  } catch {
    return res.status(500).json({ message: 'Unable to load invitations' });
  }
});

async function respondToInvitation(req, res, status) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invitationResult = await client.query(
      `SELECT * FROM invitations WHERE id = $1 AND LOWER(invitee_email) = LOWER($2) AND status = 'pending' FOR UPDATE`,
      [req.params.id, req.user.email]
    );
    const invitation = invitationResult.rows[0];
    if (!invitation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Invitation not found or already answered' });
    }

    if (status === 'accepted') {
      await client.query(
        `INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, user_id) DO NOTHING`,
        [invitation.channel_id, req.user.id, invitation.role]
      );
    }

    await client.query('UPDATE invitations SET status = $1 WHERE id = $2', [status, invitation.id]);
    await client.query('COMMIT');

    const updated = await query('SELECT * FROM invitations WHERE id = $1', [invitation.id]);
    return res.json({ invitation: updated.rows[0] });
  } catch {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Unable to respond to invitation' });
  } finally {
    client.release();
  }
}

router.post('/:id/accept', (req, res) => respondToInvitation(req, res, 'accepted'));
router.post('/:id/decline', (req, res) => respondToInvitation(req, res, 'declined'));

// Admins may withdraw an outstanding invitation.
router.delete('/:id', async (req, res) => {
  try {
    const invitationResult = await query('SELECT * FROM invitations WHERE id = $1', [req.params.id]);
    const invitation = invitationResult.rows[0];
    if (!invitation) return res.status(404).json({ message: 'Invitation not found' });

    const membership = await query(
      'SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [invitation.channel_id, req.user.id]
    );
    if (membership.rows[0]?.role !== 'admin') {
      return res.status(403).json({ message: 'Only channel admins can revoke invitations' });
    }
    if (invitation.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending invitations can be revoked' });
    }

    await query('UPDATE invitations SET status = $1 WHERE id = $2', ['declined', req.params.id]);
    return res.json({ message: 'Invitation revoked' });
  } catch {
    return res.status(500).json({ message: 'Unable to revoke invitation' });
  }
});

export default router;

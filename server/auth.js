import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from './db.js';

const router = express.Router();

function createToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email };
}

export function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: 'Please login first' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ message: 'Please login first' });
  }
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

router.post('/register', async (req, res) => {
  const { username, email, password, confirmPassword } = req.body;

  if (!username?.trim() || !email?.trim() || !password || password !== confirmPassword) {
    return res.status(400).json({ message: 'Please provide valid registration details' });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existingUser.rowCount > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username.trim(), normalizedEmail, passwordHash]
    );
    const user = result.rows[0];

    return res.status(201).json({ token: createToken(user), user: publicUser(user) });
  } catch {
    return res.status(500).json({ message: 'Unable to register user' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [email?.toLowerCase().trim()]);
    const user = result.rows[0];
    const validPassword = user && await bcrypt.compare(password || '', user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    return res.json({ token: createToken(user), user: publicUser(user) });
  } catch {
    return res.status(500).json({ message: 'Unable to login' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query('SELECT id, username, email FROM users WHERE id = $1', [req.user.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({ user: result.rows[0] });
  } catch {
    return res.status(500).json({ message: 'Unable to load user' });
  }
});

export default router;

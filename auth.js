const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');

const router = express.Router();

router.post('/signup', async (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (!['patient', 'doctor'].includes(role)) {
    return res.status(400).json({ error: 'invalid_role' });
  }
  const cleanUser = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,32}$/.test(cleanUser)) {
    return res.status(400).json({ error: 'invalid_username' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'weak_password' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUser);
  if (existing) return res.status(409).json({ error: 'username_taken' });

  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, ?, ?)'
  ).run(cleanUser, hash, role, String(name).trim());

  const user = { id: info.lastInsertRowid, username: cleanUser, role, name: String(name).trim() };
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });

  const cleanUser = String(username).trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUser);
  if (!row) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  const user = { id: row.id, username: row.username, role: row.role, name: row.name };
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user });
});

module.exports = router;

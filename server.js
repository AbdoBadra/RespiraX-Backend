require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

/* ================= إعدادات أساسية ================= */
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing. Set it in your environment variables before starting.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 4000;

/* ================= قاعدة البيانات ================= */
const db = new Database(path.join(__dirname, 'respirax.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('patient','doctor')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  device_secret TEXT UNIQUE NOT NULL,
  pairing_code TEXT UNIQUE,
  pairing_code_expires_at TEXT,
  label TEXT DEFAULT 'RespiraX Device',
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  mq135 REAL NOT NULL,
  mq8 REAL NOT NULL,
  mq4 REAL NOT NULL,
  temperature REAL NOT NULL,
  humidity REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'device' CHECK(source IN ('device','demo')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS doctor_patient_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  UNIQUE(doctor_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_readings_patient ON readings(patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_links_patient ON doctor_patient_links(patient_id);
CREATE INDEX IF NOT EXISTS idx_links_doctor ON doctor_patient_links(doctor_id);
`);

/* ================= أدوات مساعدة ================= */
function genPairingCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}
function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

/* ================= التطبيق ================= */
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'respirax-backend' }));

/* ---------- Auth ---------- */
app.post('/api/auth/signup', async (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name || !role) return res.status(400).json({ error: 'missing_fields' });
  if (!['patient', 'doctor'].includes(role)) return res.status(400).json({ error: 'invalid_role' });

  const cleanUser = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,32}$/.test(cleanUser)) return res.status(400).json({ error: 'invalid_username' });
  if (String(password).length < 8) return res.status(400).json({ error: 'weak_password' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUser);
  if (existing) return res.status(409).json({ error: 'username_taken' });

  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare('INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, ?, ?)')
    .run(cleanUser, hash, role, String(name).trim());

  const user = { id: info.lastInsertRowid, username: cleanUser, role, name: String(name).trim() };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });

  const cleanUser = String(username).trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUser);
  if (!row) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  const user = { id: row.id, username: row.username, role: row.role, name: row.name };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user });
});

/* ---------- Patients ---------- */
const patientRouter = express.Router();
patientRouter.use(requireAuth, requireRole('patient'));

patientRouter.get('/me/readings', (req, res) => {
  const rows = db.prepare('SELECT * FROM readings WHERE patient_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user.id);
  res.json({ readings: rows });
});

patientRouter.post('/me/readings/demo', (req, res) => {
  const rnd = (min, max) => Math.round((Math.random() * (max - min) + min) * 10) / 10;
  const r = { mq135: rnd(10, 90), mq8: rnd(5, 80), mq4: rnd(5, 80), temperature: rnd(36.1, 38.4), humidity: rnd(30, 65) };
  const info = db.prepare(`INSERT INTO readings (patient_id, device_id, mq135, mq8, mq4, temperature, humidity, source)
    VALUES (?, NULL, ?, ?, ?, ?, ?, 'demo')`).run(req.user.id, r.mq135, r.mq8, r.mq4, r.temperature, r.humidity);
  res.status(201).json({ id: info.lastInsertRowid, ...r });
});

patientRouter.post('/me/device/claim', (req, res) => {
  const { pairing_code } = req.body || {};
  if (!pairing_code) return res.status(400).json({ error: 'missing_pairing_code' });
  const device = db.prepare('SELECT * FROM devices WHERE pairing_code = ?').get(String(pairing_code).trim());
  if (!device) return res.status(404).json({ error: 'invalid_code' });
  if (device.pairing_code_expires_at && new Date(device.pairing_code_expires_at) < new Date()) {
    return res.status(410).json({ error: 'code_expired' });
  }
  db.prepare('UPDATE devices SET patient_id = ?, pairing_code = NULL, pairing_code_expires_at = NULL WHERE id = ?')
    .run(req.user.id, device.id);
  res.json({ ok: true, label: device.label });
});

patientRouter.get('/me/devices', (req, res) => {
  const rows = db.prepare('SELECT id, label, last_seen_at, created_at FROM devices WHERE patient_id = ?').all(req.user.id);
  res.json({ devices: rows });
});

patientRouter.delete('/me/devices/:id', (req, res) => {
  db.prepare('DELETE FROM devices WHERE id = ? AND patient_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

patientRouter.get('/me/doctor-requests', (req, res) => {
  const rows = db.prepare(`
    SELECT l.id, u.username, u.name, l.created_at
    FROM doctor_patient_links l JOIN users u ON u.id = l.doctor_id
    WHERE l.patient_id = ? AND l.status = 'pending'
  `).all(req.user.id);
  res.json({ requests: rows });
});

patientRouter.get('/me/doctors', (req, res) => {
  const rows = db.prepare(`
    SELECT u.username, u.name, l.updated_at
    FROM doctor_patient_links l JOIN users u ON u.id = l.doctor_id
    WHERE l.patient_id = ? AND l.status = 'approved'
  `).all(req.user.id);
  res.json({ doctors: rows });
});

patientRouter.post('/me/doctor-requests/:linkId/respond', (req, res) => {
  const { decision } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'invalid_decision' });
  const link = db.prepare('SELECT * FROM doctor_patient_links WHERE id = ? AND patient_id = ?').get(req.params.linkId, req.user.id);
  if (!link) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE doctor_patient_links SET status = ?, updated_at = datetime('now') WHERE id = ?").run(decision, link.id);
  res.json({ ok: true });
});

app.use('/api/patients', patientRouter);

/* ---------- Doctors ---------- */
const doctorRouter = express.Router();
doctorRouter.use(requireAuth, requireRole('doctor'));

doctorRouter.post('/me/requests', (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'missing_username' });
  const patient = db.prepare("SELECT * FROM users WHERE username = ? AND role = 'patient'").get(String(username).trim().toLowerCase());
  if (!patient) return res.status(404).json({ error: 'patient_not_found' });

  const existing = db.prepare('SELECT * FROM doctor_patient_links WHERE doctor_id = ? AND patient_id = ?').get(req.user.id, patient.id);
  if (existing && existing.status !== 'rejected') return res.status(409).json({ error: 'link_already_exists', status: existing.status });

  if (existing) {
    db.prepare("UPDATE doctor_patient_links SET status = 'pending', updated_at = datetime('now') WHERE id = ?").run(existing.id);
  } else {
    db.prepare("INSERT INTO doctor_patient_links (doctor_id, patient_id, status) VALUES (?, ?, 'pending')").run(req.user.id, patient.id);
  }
  res.status(201).json({ ok: true });
});

doctorRouter.get('/me/patients', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.name
    FROM doctor_patient_links l JOIN users u ON u.id = l.patient_id
    WHERE l.doctor_id = ? AND l.status = 'approved'
  `).all(req.user.id);
  res.json({ patients: rows });
});

doctorRouter.get('/me/patients/:patientId/readings', (req, res) => {
  const link = db.prepare("SELECT * FROM doctor_patient_links WHERE doctor_id = ? AND patient_id = ? AND status = 'approved'")
    .get(req.user.id, req.params.patientId);
  if (!link) return res.status(403).json({ error: 'not_linked' });
  const patient = db.prepare('SELECT id, username, name FROM users WHERE id = ?').get(req.params.patientId);
  const readings = db.prepare('SELECT * FROM readings WHERE patient_id = ? ORDER BY created_at DESC LIMIT 200').all(req.params.patientId);
  res.json({ patient, readings });
});

app.use('/api/doctors', doctorRouter);

/* ---------- Device (ESP32) ---------- */
const deviceRouter = express.Router();

deviceRouter.post('/register', (req, res) => {
  const deviceSecret = crypto.randomBytes(24).toString('hex');
  let pairingCode = genPairingCode();
  while (db.prepare('SELECT id FROM devices WHERE pairing_code = ?').get(pairingCode)) pairingCode = genPairingCode();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO devices (patient_id, device_secret, pairing_code, pairing_code_expires_at) VALUES (NULL, ?, ?, ?)')
    .run(deviceSecret, pairingCode, expires);
  res.status(201).json({ device_secret: deviceSecret, pairing_code: pairingCode, expires_at: expires });
});

deviceRouter.get('/status', (req, res) => {
  const { device_secret } = req.query;
  if (!device_secret) return res.status(400).json({ error: 'missing_device_secret' });
  const device = db.prepare('SELECT * FROM devices WHERE device_secret = ?').get(device_secret);
  if (!device) return res.status(404).json({ error: 'unknown_device' });
  res.json({ paired: !!device.patient_id });
});

deviceRouter.post('/refresh-code', (req, res) => {
  const { device_secret } = req.body || {};
  const device = db.prepare('SELECT * FROM devices WHERE device_secret = ?').get(device_secret);
  if (!device) return res.status(404).json({ error: 'unknown_device' });
  if (device.patient_id) return res.json({ paired: true });
  let pairingCode = genPairingCode();
  while (db.prepare('SELECT id FROM devices WHERE pairing_code = ?').get(pairingCode)) pairingCode = genPairingCode();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('UPDATE devices SET pairing_code = ?, pairing_code_expires_at = ? WHERE id = ?').run(pairingCode, expires, device.id);
  res.json({ pairing_code: pairingCode, expires_at: expires });
});

deviceRouter.post('/readings', (req, res) => {
  const { device_secret, mq135, mq8, mq4, temperature, humidity } = req.body || {};
  if (!device_secret) return res.status(400).json({ error: 'missing_device_secret' });
  const nums = [mq135, mq8, mq4, temperature, humidity];
  if (nums.some((n) => typeof n !== 'number' || Number.isNaN(n))) return res.status(400).json({ error: 'invalid_reading_values' });

  const device = db.prepare('SELECT * FROM devices WHERE device_secret = ?').get(device_secret);
  if (!device) return res.status(404).json({ error: 'unknown_device' });
  if (!device.patient_id) return res.status(403).json({ error: 'device_not_paired' });

  db.prepare(`INSERT INTO readings (patient_id, device_id, mq135, mq8, mq4, temperature, humidity, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'device')`).run(device.patient_id, device.id, mq135, mq8, mq4, temperature, humidity);
  db.prepare("UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?").run(device.id);
  res.status(201).json({ ok: true });
});

app.use('/api/device', deviceRouter);

/* ---------- 404 + error handling ---------- */
app.use((req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

app.listen(PORT, () => console.log(`RespiraX backend running on port ${PORT}`));

const Database = require('better-sqlite3');
const path = require('path');

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
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

module.exports = db;

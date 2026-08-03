const express = require('express');
const crypto = require('crypto');
const db = require('../db/db');

const router = express.Router();

function genPairingCode() {
  // 6-digit numeric code, easy to read off a small device screen
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Called once by the ESP32 on first boot (or after a factory reset) to obtain
// a permanent device_secret and a short-lived pairing_code to show on its screen.
router.post('/register', (req, res) => {
  const deviceSecret = crypto.randomBytes(24).toString('hex');
  let pairingCode = genPairingCode();
  // avoid rare collisions with an active code
  while (db.prepare('SELECT id FROM devices WHERE pairing_code = ?').get(pairingCode)) {
    pairingCode = genPairingCode();
  }
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  db.prepare(`
    INSERT INTO devices (patient_id, device_secret, pairing_code, pairing_code_expires_at)
    VALUES (NULL, ?, ?, ?)
  `).run(deviceSecret, pairingCode, expires);

  res.status(201).json({ device_secret: deviceSecret, pairing_code: pairingCode, expires_at: expires });
});

// The ESP32 polls this to find out once a patient has entered its pairing code
// on the website, so it can stop showing the code and start sending readings.
router.get('/status', (req, res) => {
  const { device_secret } = req.query;
  if (!device_secret) return res.status(400).json({ error: 'missing_device_secret' });
  const device = db.prepare('SELECT * FROM devices WHERE device_secret = ?').get(device_secret);
  if (!device) return res.status(404).json({ error: 'unknown_device' });
  res.json({ paired: !!device.patient_id });
});

// If the pairing code expired before the patient entered it, the device can
// request a fresh one without losing its device_secret / identity.
router.post('/refresh-code', (req, res) => {
  const { device_secret } = req.body || {};
  const device = db.prepare('SELECT * FROM devices WHERE device_secret = ?').get(device_secret);
  if (!device) return res.status(404).json({ error: 'unknown_device' });
  if (device.patient_id) return res.json({ paired: true });

  let pairingCode = genPairingCode();
  while (db.prepare('SELECT id FROM devices WHERE pairing_code = ?').get(pairingCode)) {
    pairingCode = genPairingCode();
  }
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('UPDATE devices SET pairing_code = ?, pairing_code_expires_at = ? WHERE id = ?')
    .run(pairingCode, expires, device.id);
  res.json({ pairing_code: pairingCode, expires_at: expires });
});

// The ESP32 calls this every time it takes a breath sample and has readings ready.
router.post('/readings', (req, res) => {
  const { device_secret, mq135, mq8, mq4, temperature, humidity } = req.body || {};
  if (!device_secret) return res.status(400).json({ error: 'missing_device_secret' });
  const nums = [mq135, mq8, mq4, temperature, humidity];
  if (nums.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
    return res.status(400).json({ error: 'invalid_reading_values' });
  }

  const device = db.prepare('SELECT * FROM devices WHERE device_secret = ?').get(device_secret);
  if (!device) return res.status(404).json({ error: 'unknown_device' });
  if (!device.patient_id) return res.status(403).json({ error: 'device_not_paired' });

  db.prepare(`
    INSERT INTO readings (patient_id, device_id, mq135, mq8, mq4, temperature, humidity, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'device')
  `).run(device.patient_id, device.id, mq135, mq8, mq4, temperature, humidity);

  db.prepare('UPDATE devices SET last_seen_at = datetime(\'now\') WHERE id = ?').run(device.id);

  res.status(201).json({ ok: true });
});

module.exports = router;

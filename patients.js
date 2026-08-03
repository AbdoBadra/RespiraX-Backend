const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('patient'));

// All readings for the logged-in patient, most recent first
router.get('/me/readings', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM readings WHERE patient_id = ? ORDER BY created_at DESC LIMIT 200'
  ).all(req.user.id);
  res.json({ readings: rows });
});

// Demo reading, for trying the interface without real hardware
router.post('/me/readings/demo', (req, res) => {
  const rnd = (min, max) => Math.round((Math.random() * (max - min) + min) * 10) / 10;
  const reading = {
    mq135: rnd(10, 90), mq8: rnd(5, 80), mq4: rnd(5, 80),
    temperature: rnd(36.1, 38.4), humidity: rnd(30, 65),
  };
  const info = db.prepare(`
    INSERT INTO readings (patient_id, device_id, mq135, mq8, mq4, temperature, humidity, source)
    VALUES (?, NULL, ?, ?, ?, ?, ?, 'demo')
  `).run(req.user.id, reading.mq135, reading.mq8, reading.mq4, reading.temperature, reading.humidity);
  res.status(201).json({ id: info.lastInsertRowid, ...reading });
});

// Enter the pairing code shown on the device's screen to link it to this account
router.post('/me/device/claim', (req, res) => {
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

// Devices currently linked to this patient
router.get('/me/devices', (req, res) => {
  const rows = db.prepare(
    'SELECT id, label, last_seen_at, created_at FROM devices WHERE patient_id = ?'
  ).all(req.user.id);
  res.json({ devices: rows });
});

router.delete('/me/devices/:id', (req, res) => {
  db.prepare('DELETE FROM devices WHERE id = ? AND patient_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Pending doctor link requests
router.get('/me/doctor-requests', (req, res) => {
  const rows = db.prepare(`
    SELECT l.id, u.username, u.name, l.created_at
    FROM doctor_patient_links l JOIN users u ON u.id = l.doctor_id
    WHERE l.patient_id = ? AND l.status = 'pending'
  `).all(req.user.id);
  res.json({ requests: rows });
});

router.get('/me/doctors', (req, res) => {
  const rows = db.prepare(`
    SELECT u.username, u.name, l.updated_at
    FROM doctor_patient_links l JOIN users u ON u.id = l.doctor_id
    WHERE l.patient_id = ? AND l.status = 'approved'
  `).all(req.user.id);
  res.json({ doctors: rows });
});

router.post('/me/doctor-requests/:linkId/respond', (req, res) => {
  const { decision } = req.body || {}; // 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'invalid_decision' });

  const link = db.prepare('SELECT * FROM doctor_patient_links WHERE id = ? AND patient_id = ?')
    .get(req.params.linkId, req.user.id);
  if (!link) return res.status(404).json({ error: 'not_found' });

  db.prepare('UPDATE doctor_patient_links SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(decision, link.id);
  res.json({ ok: true });
});

module.exports = router;

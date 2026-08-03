const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('doctor'));

// Send (or re-send) a link request to a patient by username
router.post('/me/requests', (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'missing_username' });

  const patient = db.prepare('SELECT * FROM users WHERE username = ? AND role = \'patient\'')
    .get(String(username).trim().toLowerCase());
  if (!patient) return res.status(404).json({ error: 'patient_not_found' });

  const existing = db.prepare('SELECT * FROM doctor_patient_links WHERE doctor_id = ? AND patient_id = ?')
    .get(req.user.id, patient.id);
  if (existing && existing.status !== 'rejected') {
    return res.status(409).json({ error: 'link_already_exists', status: existing.status });
  }

  if (existing) {
    db.prepare('UPDATE doctor_patient_links SET status = \'pending\', updated_at = datetime(\'now\') WHERE id = ?')
      .run(existing.id);
  } else {
    db.prepare('INSERT INTO doctor_patient_links (doctor_id, patient_id, status) VALUES (?, ?, \'pending\')')
      .run(req.user.id, patient.id);
  }
  res.status(201).json({ ok: true });
});

// Patients who approved this doctor
router.get('/me/patients', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.name
    FROM doctor_patient_links l JOIN users u ON u.id = l.patient_id
    WHERE l.doctor_id = ? AND l.status = 'approved'
  `).all(req.user.id);
  res.json({ patients: rows });
});

// A specific approved patient's reading history
router.get('/me/patients/:patientId/readings', (req, res) => {
  const link = db.prepare(
    'SELECT * FROM doctor_patient_links WHERE doctor_id = ? AND patient_id = ? AND status = \'approved\''
  ).get(req.user.id, req.params.patientId);
  if (!link) return res.status(403).json({ error: 'not_linked' });

  const patient = db.prepare('SELECT id, username, name FROM users WHERE id = ?').get(req.params.patientId);
  const readings = db.prepare(
    'SELECT * FROM readings WHERE patient_id = ? ORDER BY created_at DESC LIMIT 200'
  ).all(req.params.patientId);
  res.json({ patient, readings });
});

module.exports = router;

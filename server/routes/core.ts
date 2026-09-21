import { Router } from 'express';
import { db } from '../db.js';
import { login, logout, requireRole, COOKIE } from '../lib/auth.js';
import { eligibility, RADIUS_STAGES, STAGE_SECONDS, PHONE_HIDDEN } from '../lib/domain.js';
import { emit } from '../lib/bus.js';

export const core = Router();

// ---------------------------------------------------------------- session
core.post('/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const errors: Record<string, string> = {};
  if (!email?.trim()) errors.email = 'Enter your registered email.';
  if (!password) errors.password = 'Enter your password.';
  if (Object.keys(errors).length) return res.status(422).json({ error: 'validation', errors });

  const result = login(email, password, req.get('user-agent') ?? undefined);
  if (!result) {
    return res.status(401).json({
      error: 'bad_credentials',
      message: 'That email and password combination was not recognised.',
    });
  }
  res.cookie(COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 3600_000,
  });
  res.json({ account: result.account });
});

core.post('/auth/logout', (req, res) => {
  logout(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

core.get('/auth/me', (req, res) => {
  if (!req.account) return res.status(401).json({ error: 'not_signed_in' });
  res.json({ account: req.account });
});

// ---------------------------------------------------------------- reference
core.get('/meta', (_req, res) => {
  res.json({
    hospitals: db.prepare('SELECT id,name,locality,address,lat,lng,phone FROM hospitals ORDER BY name').all(),
    banks: db.prepare('SELECT id,name,locality,address,lat,lng,phone,licence_no FROM blood_banks WHERE is_active=1 ORDER BY name').all(),
    bloodGroups: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'],
    components: [
      { value: 'whole_blood', label: 'Whole blood' },
      { value: 'prbc', label: 'Packed red cells' },
      { value: 'platelets', label: 'Platelets' },
      { value: 'plasma', label: 'Plasma' },
    ],
    radiusStages: RADIUS_STAGES,
    stageSeconds: STAGE_SECONDS,
  });
});

// ---------------------------------------------------------------- donor portal
core.get('/donor/profile', requireRole('donor'), (req, res) => {
  const d = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.account!.donor_id) as any;
  res.json({ donor: d, eligibility: eligibility(d) });
});

core.patch('/donor/profile', requireRole('donor'), (req, res) => {
  const { locality, contact_pref, phone, quiet_hours } = req.body ?? {};
  const errors: Record<string, string> = {};
  if (phone !== undefined && !/^[6-9]\d{9}$/.test(String(phone))) {
    errors.phone = 'Enter a 10-digit Indian mobile number.';
  }
  if (contact_pref !== undefined && !['call', 'sms', 'whatsapp', 'in_app'].includes(contact_pref)) {
    errors.contact_pref = 'Choose a valid contact preference.';
  }
  if (Object.keys(errors).length) return res.status(422).json({ error: 'validation', errors });

  db.prepare(
    `UPDATE donors SET
       locality = COALESCE(?, locality),
       contact_pref = COALESCE(?, contact_pref),
       phone = COALESCE(?, phone),
       quiet_hours = COALESCE(?, quiet_hours)
     WHERE id = ?`
  ).run(locality ?? null, contact_pref ?? null, phone ?? null,
        quiet_hours === undefined ? null : quiet_hours ? 1 : 0, req.account!.donor_id);

  const d = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.account!.donor_id) as any;
  res.json({ donor: d, eligibility: eligibility(d) });
});

core.post('/donor/availability', requireRole('donor'), (req, res) => {
  const { is_available, until, reason } = req.body ?? {};
  if (typeof is_available !== 'boolean') {
    return res.status(422).json({ error: 'validation', errors: { is_available: 'Required.' } });
  }
  db.prepare(
    'UPDATE donors SET is_available = ?, unavailable_until = ?, unavailable_reason = ? WHERE id = ?'
  ).run(is_available ? 1 : 0, is_available ? null : until ?? null,
        is_available ? null : reason ?? null, req.account!.donor_id);

  const d = db.prepare('SELECT * FROM donors WHERE id = ?').get(req.account!.donor_id) as any;
  emit('donor:availability', { donorId: d.id, is_available: d.is_available });
  res.json({ donor: d, eligibility: eligibility(d) });
});

core.get('/donor/requests', requireRole('donor'), (req, res) => {
  const rows = db.prepare(
    `SELECT m.id AS match_id, m.distance_km, m.radius_stage, m.notified_at, m.response,
            r.id AS request_id, r.ref_code, r.blood_group, r.component, r.units_needed,
            r.units_pledged, r.urgency, r.status, r.verification_state, r.ward,
            r.attendant_name, r.attendant_phone, r.notes,
            h.name AS hospital_name, h.locality AS hospital_locality, h.address AS hospital_address
     FROM request_matches m
     JOIN requests r ON r.id = m.request_id
     JOIN hospitals h ON h.id = r.hospital_id
     WHERE m.donor_id = ?
     ORDER BY CASE m.response WHEN 'pending' THEN 0 ELSE 1 END, m.notified_at DESC`
  ).all(req.account!.donor_id) as any[];

  // attendant contact is withheld until this donor has accepted
  rows.forEach((r) => {
    if (r.response !== 'accepted') r.attendant_phone = PHONE_HIDDEN;
  });
  res.json({ matches: rows });
});

core.post('/donor/requests/:matchId/respond', requireRole('donor'), (req, res) => {
  const { action } = req.body ?? {};
  if (!['accept', 'decline'].includes(action)) {
    return res.status(422).json({ error: 'validation', errors: { action: 'Use accept or decline.' } });
  }
  const m = db.prepare(
    'SELECT * FROM request_matches WHERE id = ? AND donor_id = ?'
  ).get(req.params.matchId, req.account!.donor_id) as any;
  if (!m) return res.status(404).json({ error: 'not_found', message: 'That request is no longer listed for you.' });
  if (m.response !== 'pending') {
    return res.status(409).json({ error: 'already_answered', message: `You already marked this ${m.response}.` });
  }

  const accepted = action === 'accept';
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE request_matches SET response = ?, responded_at = datetime('now'), units_pledged = ?
       WHERE id = ?`
    ).run(accepted ? 'accepted' : 'declined', accepted ? 1 : 0, m.id);

    if (accepted) {
      db.prepare('UPDATE requests SET units_pledged = units_pledged + 1 WHERE id = ?').run(m.request_id);
      db.prepare(
        `UPDATE requests SET status =
           CASE WHEN units_pledged >= units_needed THEN 'fulfilled' ELSE 'partially_fulfilled' END,
         fulfilled_at = CASE WHEN units_pledged >= units_needed THEN datetime('now') ELSE fulfilled_at END
         WHERE id = ? AND status IN ('broadcasting','partially_fulfilled')`
      ).run(m.request_id);
    }
  });
  tx();

  const req_ = db.prepare('SELECT * FROM requests WHERE id = ?').get(m.request_id) as any;
  emit('request:response', {
    requestId: m.request_id,
    ref: req_.ref_code,
    response: accepted ? 'accepted' : 'declined',
    unitsPledged: req_.units_pledged,
    unitsNeeded: req_.units_needed,
  });

  const fresh = db.prepare(
    `SELECT m.*, r.attendant_name, r.attendant_phone, h.name AS hospital_name
     FROM request_matches m JOIN requests r ON r.id = m.request_id
     JOIN hospitals h ON h.id = r.hospital_id WHERE m.id = ?`
  ).get(m.id) as any;
  if (fresh.response !== 'accepted') fresh.attendant_phone = PHONE_HIDDEN;
  res.json({ match: fresh });
});

core.get('/donor/history', requireRole('donor'), (req, res) => {
  const donations = db.prepare(
    `SELECT d.*, b.name AS bank_name, b.locality AS bank_locality
     FROM donations d LEFT JOIN blood_banks b ON b.id = d.bank_id
     WHERE d.donor_id = ? ORDER BY d.donated_on DESC`
  ).all(req.account!.donor_id);
  const badges = db.prepare(
    `SELECT b.code, b.label, b.descriptor, b.threshold, db_.earned_on
     FROM donor_badges db_ JOIN badges b ON b.id = db_.badge_id
     WHERE db_.donor_id = ? ORDER BY db_.earned_on DESC`
  ).all(req.account!.donor_id);
  const allBadges = db.prepare('SELECT code,label,descriptor,threshold FROM badges').all();
  res.json({ donations, badges, allBadges });
});

core.get('/donor/camps', requireRole('donor'), (req, res) => {
  const camps = db.prepare(
    `SELECT c.*, b.name AS bank_name,
            (SELECT COUNT(*) FROM camp_registrations cr WHERE cr.camp_id = c.id AND cr.status='registered') AS registered,
            (SELECT cr.status FROM camp_registrations cr WHERE cr.camp_id = c.id AND cr.donor_id = ?) AS my_status,
            (SELECT cr.slot_time FROM camp_registrations cr WHERE cr.camp_id = c.id AND cr.donor_id = ?) AS my_slot
     FROM camps c LEFT JOIN blood_banks b ON b.id = c.bank_id
     WHERE c.status IN ('scheduled','ongoing')
     ORDER BY c.camp_date`
  ).all(req.account!.donor_id, req.account!.donor_id);
  res.json({ camps });
});

core.post('/donor/camps/:campId/register', requireRole('donor'), (req, res) => {
  const { slot_time } = req.body ?? {};
  const camp = db.prepare("SELECT * FROM camps WHERE id = ? AND status='scheduled'").get(req.params.campId) as any;
  if (!camp) return res.status(404).json({ error: 'not_found', message: 'That camp is not open for registration.' });

  const count = db.prepare(
    "SELECT COUNT(*) n FROM camp_registrations WHERE camp_id = ? AND status='registered'"
  ).get(camp.id) as any;
  if (count.n >= camp.capacity) {
    return res.status(409).json({ error: 'camp_full', message: 'All slots at this camp are taken.' });
  }
  db.prepare(
    `INSERT INTO camp_registrations (camp_id,donor_id,slot_time,status) VALUES (?,?,?,'registered')
     ON CONFLICT(camp_id,donor_id) DO UPDATE SET status='registered', slot_time=excluded.slot_time`
  ).run(camp.id, req.account!.donor_id, slot_time ?? camp.start_time);
  res.json({ ok: true });
});

core.delete('/donor/camps/:campId/register', requireRole('donor'), (req, res) => {
  db.prepare(
    "UPDATE camp_registrations SET status='cancelled' WHERE camp_id = ? AND donor_id = ?"
  ).run(req.params.campId, req.account!.donor_id);
  res.json({ ok: true });
});

core.get('/donor/notifications', requireRole('donor'), (req, res) => {
  res.json({
    notifications: db.prepare(
      'SELECT * FROM notifications WHERE donor_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(req.account!.donor_id),
  });
});

import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../lib/auth.js';
import {
  findCandidates, haversineKm, compatibleDonorGroups,
  RADIUS_STAGES, STAGE_SECONDS, PHONE_HIDDEN,
} from '../lib/domain.js';
import { emit } from '../lib/bus.js';

export const requester = Router();

const GROUPS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
const COMPONENTS = ['whole_blood', 'prbc', 'platelets', 'plasma'];
const URGENCY = ['critical', 'urgent', 'scheduled'];

function nextRef() {
  const n = (db.prepare('SELECT COUNT(*) c FROM requests').get() as any).c + 24124;
  return `REQ-HYD-${n}`;
}

// ---------------------------------------------------------------- create
requester.post('/requests', requireRole('requester'), (req, res) => {
  const b = req.body ?? {};
  const errors: Record<string, string> = {};

  if (!GROUPS.includes(b.blood_group)) errors.blood_group = 'Select the patient blood group.';
  if (!COMPONENTS.includes(b.component)) errors.component = 'Select the component required.';
  const units = Number(b.units_needed);
  if (!Number.isInteger(units) || units < 1) errors.units_needed = 'Enter at least 1 unit.';
  else if (units > 10) errors.units_needed = 'More than 10 units must be raised through the hospital blood bank directly.';
  if (!URGENCY.includes(b.urgency)) errors.urgency = 'Select an urgency level.';
  if (!b.patient_ref?.trim()) errors.patient_ref = 'Enter the hospital admission or IP number.';
  if (!b.attendant_name?.trim()) errors.attendant_name = 'Enter the attendant name.';
  if (!/^[6-9]\d{9}$/.test(String(b.attendant_phone ?? ''))) {
    errors.attendant_phone = 'Enter a 10-digit mobile number reachable now.';
  }
  const hospital = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(b.hospital_id) as any;
  if (!hospital) errors.hospital_id = 'Select the hospital where the patient is admitted.';

  if (Object.keys(errors).length) return res.status(422).json({ error: 'validation', errors });

  const ref = nextRef();
  const info = db.prepare(
    `INSERT INTO requests
     (ref_code,requester_account_id,patient_ref,patient_age,blood_group,component,units_needed,
      urgency,hospital_id,ward,attendant_name,attendant_phone,lat,lng,verification_state,status,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'unverified','draft',?)`
  ).run(ref, req.account!.id, b.patient_ref.trim(), b.patient_age ?? null, b.blood_group,
        b.component, units, b.urgency, hospital.id, b.ward ?? null,
        b.attendant_name.trim(), String(b.attendant_phone), hospital.lat, hospital.lng,
        b.notes ?? null);

  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ request });
});

// ---------------------------------------------------------------- OTP
requester.post('/requests/:id/otp/send', requireRole('requester'), (req, res) => {
  const r = owned(req);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.verification_state !== 'unverified') {
    return res.status(409).json({ error: 'already_verified', message: 'This request is already verified.' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare('UPDATE otp_codes SET consumed = 1 WHERE request_id = ? AND consumed = 0').run(r.id);
  db.prepare(
    'INSERT INTO otp_codes (request_id,phone,code,expires_at) VALUES (?,?,?,?)'
  ).run(r.id, r.attendant_phone, code, expires);

  res.json({
    sent_to: r.attendant_phone.replace(/^(\d{2})\d{5}(\d{3})$/, '$1XXXXX$2'),
    expires_in_seconds: 300,
    // No SMS gateway is available offline. The code is returned so the
    // verification step can be demonstrated; the client renders it in a
    // clearly marked development strip, never as part of the normal UI.
    dev_code: code,
  });
});

requester.post('/requests/:id/otp/verify', requireRole('requester'), (req, res) => {
  const r = owned(req);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const code = String(req.body?.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(422).json({ error: 'validation', errors: { code: 'Enter the 6-digit code.' } });
  }

  const otp = db.prepare(
    "SELECT * FROM otp_codes WHERE request_id = ? AND consumed = 0 ORDER BY id DESC LIMIT 1"
  ).get(r.id) as any;

  if (!otp) return res.status(409).json({ error: 'no_otp', message: 'Request a code first.' });
  if (otp.expires_at <= new Date().toISOString().slice(0, 19).replace('T', ' ')) {
    return res.status(410).json({ error: 'otp_expired', message: 'That code has expired. Request a new one.' });
  }
  if (otp.attempts >= 5) {
    return res.status(429).json({ error: 'too_many_attempts', message: 'Too many attempts. Request a new code.' });
  }
  if (otp.code !== code) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otp.id);
    return res.status(401).json({
      error: 'otp_mismatch',
      message: `Incorrect code. ${4 - otp.attempts} attempts left.`,
    });
  }

  db.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').run(otp.id);
  db.prepare("UPDATE requests SET verification_state = 'otp_verified' WHERE id = ?").run(r.id);
  res.json({ request: db.prepare('SELECT * FROM requests WHERE id = ?').get(r.id) });
});

/** Escalate to hospital verification — lands in that hospital's review queue. */
requester.post('/requests/:id/hospital-verify', requireRole('requester'), (req, res) => {
  const r = owned(req);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const ref = String(req.body?.hospital_ref_no ?? '').trim();
  if (ref.length < 4) {
    return res.status(422).json({
      error: 'validation',
      errors: { hospital_ref_no: 'Enter the reference printed on the requisition slip.' },
    });
  }
  db.prepare('UPDATE requests SET hospital_ref_no = ? WHERE id = ?').run(ref, r.id);
  emit('hospital:review', { requestId: r.id, hospitalId: r.hospital_id });
  res.json({ ok: true, message: 'Sent to the hospital blood bank for counter-verification.' });
});

// ---------------------------------------------------------------- broadcast
requester.post('/requests/:id/broadcast', requireRole('requester'), (req, res) => {
  const r = owned(req);
  if (!r) return res.status(404).json({ error: 'not_found' });

  if (r.verification_state === 'unverified') {
    return res.status(403).json({
      error: 'unverified',
      message: 'Unverified requests cannot be broadcast. Complete OTP or hospital verification first.',
    });
  }
  if (r.status !== 'draft') {
    return res.status(409).json({ error: 'already_broadcasting', message: 'This request is already live.' });
  }

  db.prepare(
    `UPDATE requests SET status='broadcasting', radius_stage=0,
     stage_started_at=datetime('now'), broadcast_at=datetime('now') WHERE id = ?`
  ).run(r.id);

  const notified = notifyStage(r.id, 0);
  emit('request:broadcast', { requestId: r.id, ref: r.ref_code, stage: 0, notified });
  res.json({
    request: db.prepare('SELECT * FROM requests WHERE id = ?').get(r.id),
    notified,
    radius_km: RADIUS_STAGES[0],
  });
});

/** Widen the radius: automatic on the timer, or manual from the tracker. */
requester.post('/requests/:id/escalate', requireRole('requester'), (req, res) => {
  const r = owned(req);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.status !== 'broadcasting' && r.status !== 'partially_fulfilled') {
    return res.status(409).json({ error: 'not_live', message: 'This request is not broadcasting.' });
  }
  if (r.radius_stage >= RADIUS_STAGES.length - 1) {
    return res.status(409).json({
      error: 'max_radius',
      message: `Already at the widest radius (${RADIUS_STAGES.at(-1)} km).`,
    });
  }

  const stage = r.radius_stage + 1;
  db.prepare("UPDATE requests SET radius_stage = ?, stage_started_at = datetime('now') WHERE id = ?")
    .run(stage, r.id);
  const notified = notifyStage(r.id, stage);
  emit('request:escalated', { requestId: r.id, ref: r.ref_code, stage, radius_km: RADIUS_STAGES[stage], notified });
  res.json({ stage, radius_km: RADIUS_STAGES[stage], notified });
});

/** Notify every newly-reachable compatible donor in the given ring. */
function notifyStage(requestId: number, stage: number) {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId) as any;
  const already = db.prepare('SELECT donor_id FROM request_matches WHERE request_id = ?')
    .all(requestId).map((x: any) => x.donor_id);

  const candidates = findCandidates({
    lat: r.lat, lng: r.lng,
    bloodGroup: r.blood_group, component: r.component,
    radiusKm: RADIUS_STAGES[stage],
    excludeDonorIds: already,
  });

  const hospital = db.prepare('SELECT name, locality FROM hospitals WHERE id = ?').get(r.hospital_id) as any;
  const insM = db.prepare(
    `INSERT OR IGNORE INTO request_matches (request_id,donor_id,distance_km,radius_stage)
     VALUES (?,?,?,?)`
  );
  const insN = db.prepare(
    'INSERT INTO notifications (donor_id,kind,title,body,request_id) VALUES (?,?,?,?,?)'
  );

  db.transaction(() => {
    candidates.forEach((c) => {
      insM.run(requestId, c.id, c.distance_km, stage);
      insN.run(c.id, 'request', `${r.blood_group} ${r.urgency === 'critical' ? 'critical' : ''} request nearby`.trim(),
        `${r.units_needed} unit(s) needed at ${hospital.name}, ${hospital.locality} — ${c.distance_km} km direct`,
        requestId);
    });
  })();

  return candidates.length;
}

// ---------------------------------------------------------------- tracker
requester.get('/requests/:id/tracker', requireRole('requester'), (req, res) => {
  const r = owned(req);
  if (!r) return res.status(404).json({ error: 'not_found' });

  const matches = db.prepare(
    `SELECT m.id, m.distance_km, m.radius_stage, m.notified_at, m.response, m.responded_at,
            d.id AS donor_id, d.full_name, d.blood_group, d.locality, d.phone, d.contact_pref,
            d.verification_state AS donor_verification
     FROM request_matches m JOIN donors d ON d.id = m.donor_id
     WHERE m.request_id = ?
     ORDER BY CASE m.response WHEN 'accepted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, m.distance_km`
  ).all(r.id) as any[];

  // the contact-hiding rule, enforced server-side so it cannot be bypassed
  matches.forEach((m) => {
    if (m.response !== 'accepted') {
      m.phone = PHONE_HIDDEN;
      m.full_name = maskName(m.full_name);
    }
  });

  const stageStarted = r.stage_started_at ? new Date(r.stage_started_at + 'Z').getTime() : null;
  const elapsed = stageStarted ? Math.floor((Date.now() - stageStarted) / 1000) : 0;

  res.json({
    request: r,
    hospital: db.prepare('SELECT * FROM hospitals WHERE id = ?').get(r.hospital_id),
    matches,
    summary: {
      notified: matches.length,
      accepted: matches.filter((m) => m.response === 'accepted').length,
      declined: matches.filter((m) => m.response === 'declined').length,
      pending: matches.filter((m) => m.response === 'pending').length,
      units_pledged: r.units_pledged,
      units_needed: r.units_needed,
    },
    radius: {
      stage: r.radius_stage,
      km: RADIUS_STAGES[r.radius_stage],
      stages: RADIUS_STAGES,
      seconds_per_stage: STAGE_SECONDS,
      seconds_elapsed: elapsed,
      seconds_to_next: r.radius_stage >= RADIUS_STAGES.length - 1
        ? null : Math.max(0, STAGE_SECONDS - elapsed),
      at_max: r.radius_stage >= RADIUS_STAGES.length - 1,
    },
    bank_claims: db.prepare(
      `SELECT bc.*, b.name AS bank_name, b.phone, b.locality
       FROM bank_claims bc JOIN blood_banks b ON b.id = bc.bank_id WHERE bc.request_id = ?`
    ).all(r.id),
  });
});

function maskName(name: string) {
  const parts = name.split(' ');
  return parts[0] + ' ' + parts.slice(1).map((p) => p[0] + '.').join(' ');
}

// ---------------------------------------------------------------- bank search
requester.get('/blood-banks/availability', requireRole('requester', 'donor', 'bank', 'admin'), (req, res) => {
  const group = String(req.query.blood_group ?? '');
  const component = String(req.query.component ?? 'whole_blood');
  const hospitalId = Number(req.query.hospital_id);
  const hospital = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(hospitalId) as any;
  if (!hospital) return res.status(422).json({ error: 'validation', errors: { hospital_id: 'Unknown hospital.' } });

  const groups = GROUPS.includes(group) ? compatibleDonorGroups(group, component) : GROUPS;
  const banks = db.prepare('SELECT * FROM blood_banks WHERE is_active = 1').all() as any[];

  const rows = banks.map((b) => {
    const stock = db.prepare(
      `SELECT blood_group, SUM(units) units, MIN(expires_on) earliest_expiry
       FROM stock_batches
       WHERE bank_id = ? AND component = ? AND status = 'available'
         AND blood_group IN (${groups.map(() => '?').join(',')})
       GROUP BY blood_group`
    ).all(b.id, component, ...groups) as any[];

    return {
      id: b.id,
      name: b.name,
      locality: b.locality,
      address: b.address,
      phone: b.phone,
      licence_no: b.licence_no,
      distance_km: Math.round(haversineKm(hospital.lat, hospital.lng, b.lat, b.lng) * 10) / 10,
      total_units: stock.reduce((s, x) => s + x.units, 0),
      by_group: stock,
    };
  }).sort((a, b) => a.distance_km - b.distance_km);

  res.json({ hospital, component, requested_group: group || null, compatible_groups: groups, banks: rows });
});

// ---------------------------------------------------------------- history
requester.get('/requests', requireRole('requester'), (req, res) => {
  const rows = db.prepare(
    `SELECT r.*, h.name AS hospital_name, h.locality AS hospital_locality,
            (SELECT COUNT(*) FROM request_matches m WHERE m.request_id = r.id) AS notified,
            (SELECT COUNT(*) FROM request_matches m WHERE m.request_id = r.id AND m.response='accepted') AS accepted
     FROM requests r JOIN hospitals h ON h.id = r.hospital_id
     WHERE r.requester_account_id = ?
     ORDER BY r.created_at DESC`
  ).all(req.account!.id);
  res.json({ requests: rows });
});

requester.post('/requests/:id/cancel', requireRole('requester'), (req, res) => {
  const r = owned(req);
  if (!r) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE requests SET status='cancelled' WHERE id = ?").run(r.id);
  emit('request:cancelled', { requestId: r.id });
  res.json({ ok: true });
});

/**
 * Fetch a request ONLY if it belongs to the signed-in account.
 * Returns undefined otherwise, and every caller turns that into a 404 rather
 * than a 403 — a 403 would confirm the request exists, which is itself a leak.
 */
function owned(req: any) {
  return db
    .prepare('SELECT * FROM requests WHERE id = ? AND requester_account_id = ?')
    .get(req.params.id, req.account.id) as any;
}

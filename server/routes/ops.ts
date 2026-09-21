import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../lib/auth.js';
import { bankInventory } from '../lib/domain.js';
import { emit } from '../lib/bus.js';

export const ops = Router();

const SHELF: Record<string, number> = { whole_blood: 35, prbc: 42, platelets: 5, plasma: 365 };

// ============================================================ BANK PORTAL
ops.get('/bank/inventory', requireRole('bank'), (req, res) => {
  const bankId = req.account!.bank_id!;
  res.json({
    bank: db.prepare('SELECT * FROM blood_banks WHERE id = ?').get(bankId),
    inventory: bankInventory(bankId),
    totals: db.prepare(
      `SELECT
         SUM(CASE WHEN status='available' THEN units ELSE 0 END) available,
         SUM(CASE WHEN status='reserved' THEN units ELSE 0 END) reserved,
         SUM(CASE WHEN status='expired' THEN units ELSE 0 END) expired,
         SUM(CASE WHEN status='discarded' THEN units ELSE 0 END) discarded
       FROM stock_batches WHERE bank_id = ?`
    ).get(bankId),
  });
});

ops.get('/bank/batches', requireRole('bank'), (req, res) => {
  const bankId = req.account!.bank_id!;
  const rows = db.prepare(
    `SELECT *, CAST(julianday(expires_on) - julianday('now') AS INTEGER) AS days_to_expiry
     FROM stock_batches WHERE bank_id = ?
     ORDER BY CASE status WHEN 'available' THEN 0 WHEN 'reserved' THEN 1 ELSE 2 END, expires_on`
  ).all(bankId);
  res.json({ batches: rows });
});

ops.get('/bank/expiry', requireRole('bank'), (req, res) => {
  const bankId = req.account!.bank_id!;
  res.json({
    expiring: db.prepare(
      `SELECT *, CAST(julianday(expires_on) - julianday('now') AS INTEGER) AS days_to_expiry
       FROM stock_batches
       WHERE bank_id = ? AND status='available' AND expires_on <= date('now','+10 day')
       ORDER BY expires_on`
    ).all(bankId),
    wastage: db.prepare(
      `SELECT COUNT(*) batches, COALESCE(SUM(units),0) units
       FROM stock_batches WHERE bank_id = ? AND status IN ('expired','discarded')`
    ).get(bankId),
  });
});

/** Stock movement. Issue consumes oldest-expiring batches first (FEFO). */
ops.post('/bank/movements', requireRole('bank'), (req, res) => {
  const bankId = req.account!.bank_id!;
  const { kind, blood_group, component, units, counterparty, note } = req.body ?? {};
  const errors: Record<string, string> = {};

  if (!['receipt', 'issue', 'discard'].includes(kind)) errors.kind = 'Choose receipt, issue or discard.';
  if (!blood_group) errors.blood_group = 'Select a blood group.';
  if (!SHELF[component]) errors.component = 'Select a component.';
  const n = Number(units);
  if (!Number.isInteger(n) || n < 1) errors.units = 'Enter a whole number of units.';
  if (Object.keys(errors).length) return res.status(422).json({ error: 'validation', errors });

  if (kind === 'receipt') {
    const shelf = SHELF[component];
    const info = db.prepare(
      `INSERT INTO stock_batches (bank_id,blood_group,component,units,collected_on,expires_on,source,status)
       VALUES (?,?,?,?,date('now'),date('now',?),'voluntary','available')`
    ).run(bankId, blood_group, component, n, `+${shelf} day`);
    db.prepare(
      `INSERT INTO stock_movements (bank_id,batch_id,kind,blood_group,component,units,counterparty,note,actor)
       VALUES (?,?,'receipt',?,?,?,?,?,?)`
    ).run(bankId, info.lastInsertRowid, blood_group, component, n, counterparty ?? null, note ?? null, req.account!.full_name);
    emit('bank:stock', { bankId, blood_group, component, delta: n });
    return res.json({ ok: true, inventory: bankInventory(bankId) });
  }

  // issue / discard: draw down from batches, earliest expiry first
  const batches = db.prepare(
    `SELECT * FROM stock_batches
     WHERE bank_id = ? AND blood_group = ? AND component = ? AND status='available'
     ORDER BY expires_on`
  ).all(bankId, blood_group, component) as any[];

  const held = batches.reduce((s, b) => s + b.units, 0);
  if (held < n) {
    return res.status(409).json({
      error: 'insufficient_stock',
      message: `Only ${held} unit(s) of ${blood_group} ${component.replace('_', ' ')} on hand.`,
    });
  }

  db.transaction(() => {
    let left = n;
    for (const b of batches) {
      if (left <= 0) break;
      const take = Math.min(left, b.units);
      const remaining = b.units - take;
      db.prepare('UPDATE stock_batches SET units = ?, status = ? WHERE id = ?')
        .run(remaining, remaining === 0 ? (kind === 'issue' ? 'issued' : 'discarded') : 'available', b.id);
      db.prepare(
        `INSERT INTO stock_movements (bank_id,batch_id,kind,blood_group,component,units,counterparty,note,actor)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(bankId, b.id, kind, blood_group, component, take, counterparty ?? null, note ?? null, req.account!.full_name);
      left -= take;
    }
  })();

  emit('bank:stock', { bankId, blood_group, component, delta: -n });
  res.json({ ok: true, inventory: bankInventory(bankId) });
});

ops.get('/bank/movements', requireRole('bank'), (req, res) => {
  res.json({
    movements: db.prepare(
      'SELECT * FROM stock_movements WHERE bank_id = ? ORDER BY created_at DESC, id DESC LIMIT 100'
    ).all(req.account!.bank_id),
  });
});

/** Incoming request queue for this bank. */
ops.get('/bank/requests', requireRole('bank'), (req, res) => {
  const bankId = req.account!.bank_id!;
  res.json({
    claims: db.prepare(
      `SELECT bc.*, r.ref_code, r.blood_group, r.component, r.units_needed, r.units_pledged,
              r.urgency, r.verification_state, r.status AS request_status, r.patient_ref, r.created_at,
              h.name AS hospital_name, h.locality AS hospital_locality
       FROM bank_claims bc
       JOIN requests r ON r.id = bc.request_id
       JOIN hospitals h ON h.id = r.hospital_id
       WHERE bc.bank_id = ?
       ORDER BY CASE bc.status WHEN 'pending' THEN 0 ELSE 1 END,
                CASE r.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
                r.created_at DESC`
    ).all(bankId),
  });
});

ops.post('/bank/requests/:claimId', requireRole('bank'), (req, res) => {
  const { action, units, note } = req.body ?? {};
  if (!['accept', 'reserve', 'reject'].includes(action)) {
    return res.status(422).json({ error: 'validation', errors: { action: 'Use accept, reserve or reject.' } });
  }
  const claim = db.prepare('SELECT * FROM bank_claims WHERE id = ? AND bank_id = ?')
    .get(req.params.claimId, req.account!.bank_id) as any;
  if (!claim) return res.status(404).json({ error: 'not_found' });

  const status = action === 'accept' ? 'accepted' : action === 'reserve' ? 'reserved' : 'rejected';
  db.prepare("UPDATE bank_claims SET status = ?, units = ?, note = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, Number(units) || 0, note ?? null, claim.id);
  emit('request:bank_claim', { requestId: claim.request_id, bankId: claim.bank_id, status });
  res.json({ ok: true });
});

/** Verified-request review: hospital counter-signs or rejects. */
ops.get('/bank/verification-queue', requireRole('bank'), (req, res) => {
  const hospitalId = req.account!.hospital_id;
  if (!hospitalId) return res.json({ queue: [], note: 'This blood bank is not attached to a hospital.' });
  res.json({
    queue: db.prepare(
      `SELECT r.*, h.name AS hospital_name FROM requests r JOIN hospitals h ON h.id = r.hospital_id
       WHERE r.hospital_id = ? AND r.hospital_ref_no IS NOT NULL
         AND r.verification_state IN ('unverified','otp_verified')
       ORDER BY r.created_at DESC`
    ).all(hospitalId),
  });
});

ops.post('/bank/verification-queue/:requestId', requireRole('bank'), (req, res) => {
  const { action, note } = req.body ?? {};
  if (!['approve', 'reject'].includes(action)) {
    return res.status(422).json({ error: 'validation', errors: { action: 'Use approve or reject.' } });
  }
  const r = db.prepare('SELECT * FROM requests WHERE id = ? AND hospital_id = ?')
    .get(req.params.requestId, req.account!.hospital_id) as any;
  if (!r) return res.status(404).json({ error: 'not_found' });

  db.prepare('UPDATE requests SET verification_state = ?, notes = COALESCE(?, notes) WHERE id = ?')
    .run(action === 'approve' ? 'hospital_verified' : 'rejected', note ?? null, r.id);
  emit('request:verification', { requestId: r.id, state: action === 'approve' ? 'hospital_verified' : 'rejected' });
  res.json({ ok: true });
});

/** Inter-bank transfer. */
ops.get('/bank/transfers', requireRole('bank'), (req, res) => {
  const bankId = req.account!.bank_id!;
  res.json({
    outgoing: db.prepare(
      `SELECT t.*, b.name AS to_bank_name FROM transfers t JOIN blood_banks b ON b.id = t.to_bank_id
       WHERE t.from_bank_id = ? ORDER BY t.created_at DESC`
    ).all(bankId),
    incoming: db.prepare(
      `SELECT t.*, b.name AS from_bank_name FROM transfers t JOIN blood_banks b ON b.id = t.from_bank_id
       WHERE t.to_bank_id = ? ORDER BY t.created_at DESC`
    ).all(bankId),
  });
});

ops.post('/bank/transfers', requireRole('bank'), (req, res) => {
  const { to_bank_id, blood_group, component, units, note } = req.body ?? {};
  const errors: Record<string, string> = {};
  if (!to_bank_id || Number(to_bank_id) === req.account!.bank_id) {
    errors.to_bank_id = 'Choose a different blood bank.';
  }
  if (!blood_group) errors.blood_group = 'Select a blood group.';
  if (!SHELF[component]) errors.component = 'Select a component.';
  if (!Number.isInteger(Number(units)) || Number(units) < 1) errors.units = 'Enter a whole number of units.';
  if (Object.keys(errors).length) return res.status(422).json({ error: 'validation', errors });

  db.prepare(
    `INSERT INTO transfers (from_bank_id,to_bank_id,blood_group,component,units,note)
     VALUES (?,?,?,?,?,?)`
  ).run(req.account!.bank_id, to_bank_id, blood_group, component, Number(units), note ?? null);
  emit('bank:transfer', { from: req.account!.bank_id, to: Number(to_bank_id) });
  res.json({ ok: true });
});

ops.post('/bank/transfers/:id', requireRole('bank'), (req, res) => {
  const { action } = req.body ?? {};
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(req.params.id) as any;
  if (!t) return res.status(404).json({ error: 'not_found' });
  if (t.to_bank_id !== req.account!.bank_id) {
    return res.status(403).json({ error: 'not_recipient', message: 'Only the receiving bank can action this.' });
  }
  const status = action === 'approve' ? 'approved' : action === 'complete' ? 'completed' : 'rejected';

  db.transaction(() => {
    db.prepare('UPDATE transfers SET status = ? WHERE id = ?').run(status, t.id);
    if (status === 'completed') {
      const shelf = SHELF[t.component];
      const info = db.prepare(
        `INSERT INTO stock_batches (bank_id,blood_group,component,units,collected_on,expires_on,source,status)
         VALUES (?,?,?,?,date('now'),date('now',?),'transfer','available')`
      ).run(t.to_bank_id, t.blood_group, t.component, t.units, `+${shelf} day`);
      db.prepare(
        `INSERT INTO stock_movements (bank_id,batch_id,kind,blood_group,component,units,counterparty,actor)
         VALUES (?,?,'transfer_in',?,?,?,?,?)`
      ).run(t.to_bank_id, info.lastInsertRowid, t.blood_group, t.component, t.units,
            'Bank #' + t.from_bank_id, req.account!.full_name);
    }
  })();

  res.json({ ok: true, status });
});

/** Camp collection entry — units land in stock immediately. */
ops.post('/bank/camp-collections', requireRole('bank'), (req, res) => {
  const { camp_id, entries } = req.body ?? {};
  if (!camp_id || !Array.isArray(entries) || !entries.length) {
    return res.status(422).json({ error: 'validation', errors: { entries: 'Add at least one collection line.' } });
  }
  const bankId = req.account!.bank_id!;

  db.transaction(() => {
    for (const e of entries) {
      const shelf = SHELF[e.component] ?? 35;
      const info = db.prepare(
        `INSERT INTO stock_batches (bank_id,blood_group,component,units,collected_on,expires_on,source,status,camp_id)
         VALUES (?,?,?,?,date('now'),date('now',?),'camp','available',?)`
      ).run(bankId, e.blood_group, e.component, Number(e.units), `+${shelf} day`, camp_id);
      db.prepare(
        `INSERT INTO camp_collections (camp_id,bank_id,blood_group,component,units,collected_on,batch_id)
         VALUES (?,?,?,?,?,date('now'),?)`
      ).run(camp_id, bankId, e.blood_group, e.component, Number(e.units), info.lastInsertRowid);
      db.prepare(
        `INSERT INTO stock_movements (bank_id,batch_id,kind,blood_group,component,units,counterparty,note,actor)
         VALUES (?,?,'receipt',?,?,?,?,'Camp collection',?)`
      ).run(bankId, info.lastInsertRowid, e.blood_group, e.component, Number(e.units),
            'Camp #' + camp_id, req.account!.full_name);
    }
  })();

  emit('bank:stock', { bankId, reason: 'camp' });
  res.json({ ok: true, inventory: bankInventory(bankId) });
});

ops.get('/bank/camps', requireRole('bank'), (req, res) => {
  res.json({
    camps: db.prepare(
      `SELECT c.*, (SELECT COALESCE(SUM(units),0) FROM camp_collections cc WHERE cc.camp_id = c.id) AS units_collected
       FROM camps c WHERE c.bank_id = ? OR c.bank_id IS NULL ORDER BY c.camp_date DESC`
    ).all(req.account!.bank_id),
  });
});

// ============================================================ ADMIN PORTAL
ops.get('/admin/metrics', requireRole('admin'), (_req, res) => {
  const fulfilled = db.prepare(
    `SELECT (julianday(fulfilled_at) - julianday(broadcast_at)) * 24 * 60 AS minutes
     FROM requests WHERE status='fulfilled' AND fulfilled_at IS NOT NULL AND broadcast_at IS NOT NULL`
  ).all() as any[];
  const mins = fulfilled.map((f) => f.minutes).filter((m) => m != null).sort((a, b) => a - b);
  const median = mins.length
    ? mins.length % 2
      ? mins[(mins.length - 1) / 2]
      : (mins[mins.length / 2 - 1] + mins[mins.length / 2]) / 2
    : null;

  const counts = db.prepare(
    `SELECT
       COUNT(*) total,
       SUM(CASE WHEN status='fulfilled' THEN 1 ELSE 0 END) fulfilled,
       SUM(CASE WHEN status IN ('expired','cancelled') THEN 1 ELSE 0 END) unfulfilled,
       SUM(CASE WHEN status IN ('broadcasting','partially_fulfilled') THEN 1 ELSE 0 END) live
     FROM requests WHERE status != 'draft'`
  ).get() as any;

  const split = db.prepare(
    `SELECT donation_type, COUNT(*) n FROM donations GROUP BY donation_type`
  ).all() as any[];

  const wastage = db.prepare(
    `SELECT COALESCE(SUM(units),0) units, COUNT(*) batches
     FROM stock_batches WHERE status IN ('expired','discarded')`
  ).get() as any;

  // retention: donors with 2+ donations, of donors with any donation
  const retention = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM (SELECT donor_id FROM donations GROUP BY donor_id HAVING COUNT(*) >= 2)) repeat_donors,
       (SELECT COUNT(DISTINCT donor_id) FROM donations) any_donors`
  ).get() as any;

  res.json({
    median_fulfilment_minutes: median === null ? null : Math.round(median),
    fulfilment_rate: counts.total ? Math.round((counts.fulfilled / counts.total) * 1000) / 10 : null,
    requests: counts,
    donation_split: {
      voluntary: split.find((s) => s.donation_type === 'voluntary')?.n ?? 0,
      replacement: split.find((s) => s.donation_type === 'replacement')?.n ?? 0,
    },
    units_wasted: wastage,
    donor_retention_rate: retention.any_donors
      ? Math.round((retention.repeat_donors / retention.any_donors) * 1000) / 10
      : null,
    donors: db.prepare(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN is_available=1 THEN 1 ELSE 0 END) available,
              SUM(CASE WHEN verification_state='verified' THEN 1 ELSE 0 END) verified
       FROM donors`
    ).get(),
  });
});

ops.get('/admin/verification-queue', requireRole('admin'), (_req, res) => {
  res.json({
    queue: db.prepare(
      `SELECT v.*, d.full_name, d.blood_group, d.locality, d.phone, d.total_donations,
              d.verification_state AS current_state
       FROM verification_requests v JOIN donors d ON d.id = v.donor_id
       ORDER BY CASE v.status WHEN 'pending' THEN 0 ELSE 1 END, v.created_at DESC`
    ).all(),
    verified: db.prepare(
      `SELECT id, full_name, blood_group, locality, total_donations
       FROM donors WHERE verification_state='verified' ORDER BY full_name LIMIT 100`
    ).all(),
  });
});

ops.post('/admin/verification-queue/:donorId', requireRole('admin'), (req, res) => {
  const { action, note } = req.body ?? {};
  if (!['award', 'revoke'].includes(action)) {
    return res.status(422).json({ error: 'validation', errors: { action: 'Use award or revoke.' } });
  }
  const state = action === 'award' ? 'verified' : 'revoked';
  db.transaction(() => {
    db.prepare('UPDATE donors SET verification_state = ? WHERE id = ?').run(state, req.params.donorId);
    db.prepare(
      `UPDATE verification_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), note = ?
       WHERE donor_id = ? AND status='pending'`
    ).run(action === 'award' ? 'approved' : 'rejected', req.account!.full_name, note ?? null, req.params.donorId);
  })();
  emit('admin:verification', { donorId: Number(req.params.donorId), state });
  res.json({ ok: true, state });
});

ops.get('/admin/flags', requireRole('admin'), (_req, res) => {
  res.json({
    flags: db.prepare(
      `SELECT f.*, r.ref_code, r.patient_ref, r.blood_group, r.units_needed, r.status AS request_status,
              d.full_name AS donor_name
       FROM flags f LEFT JOIN requests r ON r.id = f.request_id
       LEFT JOIN donors d ON d.id = f.donor_id
       ORDER BY CASE f.status WHEN 'open' THEN 0 ELSE 1 END, f.created_at DESC`
    ).all(),
  });
});

ops.post('/admin/flags/:id', requireRole('admin'), (req, res) => {
  const { action } = req.body ?? {};
  if (!['uphold', 'dismiss'].includes(action)) {
    return res.status(422).json({ error: 'validation', errors: { action: 'Use uphold or dismiss.' } });
  }
  const f = db.prepare('SELECT * FROM flags WHERE id = ?').get(req.params.id) as any;
  if (!f) return res.status(404).json({ error: 'not_found' });

  db.transaction(() => {
    db.prepare("UPDATE flags SET status = ?, resolved_at = datetime('now') WHERE id = ?")
      .run(action === 'uphold' ? 'upheld' : 'dismissed', f.id);
    if (action === 'uphold' && f.request_id) {
      db.prepare("UPDATE requests SET is_flagged = 1, status='cancelled' WHERE id = ?").run(f.request_id);
    }
  })();
  res.json({ ok: true });
});

ops.get('/admin/banks', requireRole('admin'), (_req, res) => {
  res.json({
    banks: db.prepare(
      `SELECT b.*, (SELECT COALESCE(SUM(units),0) FROM stock_batches s
                    WHERE s.bank_id = b.id AND s.status='available') AS units_available
       FROM blood_banks b ORDER BY b.name`
    ).all(),
  });
});

ops.post('/admin/banks', requireRole('admin'), (req, res) => {
  const { name, locality, address, lat, lng, phone, licence_no } = req.body ?? {};
  const errors: Record<string, string> = {};
  if (!name?.trim()) errors.name = 'Enter the registered name.';
  if (!locality?.trim()) errors.locality = 'Enter the locality.';
  if (!/^\d{8,12}$/.test(String(phone ?? ''))) errors.phone = 'Enter a landline or mobile number.';
  if (!licence_no?.trim()) errors.licence_no = 'Enter the drug-licence number.';
  if (Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) errors.lat = 'Enter valid coordinates.';
  if (Object.keys(errors).length) return res.status(422).json({ error: 'validation', errors });

  db.prepare(
    'INSERT INTO blood_banks (name,locality,address,lat,lng,phone,licence_no) VALUES (?,?,?,?,?,?,?)'
  ).run(name.trim(), locality.trim(), address ?? '', Number(lat), Number(lng), String(phone), licence_no.trim());
  res.status(201).json({ ok: true });
});

ops.patch('/admin/banks/:id', requireRole('admin'), (req, res) => {
  const { is_active } = req.body ?? {};
  db.prepare('UPDATE blood_banks SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

ops.get('/admin/camps', requireRole('admin'), (_req, res) => {
  res.json({
    camps: db.prepare(
      `SELECT c.*, b.name AS bank_name,
              (SELECT COUNT(*) FROM camp_registrations r WHERE r.camp_id = c.id AND r.status='registered') registered,
              (SELECT COALESCE(SUM(units),0) FROM camp_collections cc WHERE cc.camp_id = c.id) units_collected
       FROM camps c LEFT JOIN blood_banks b ON b.id = c.bank_id ORDER BY c.camp_date DESC`
    ).all(),
  });
});

ops.post('/admin/camps', requireRole('admin'), (req, res) => {
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  if (!b.title?.trim()) errors.title = 'Enter a camp title.';
  if (!b.organiser?.trim()) errors.organiser = 'Enter the organising body.';
  if (!b.venue?.trim()) errors.venue = 'Enter the venue.';
  if (!b.locality?.trim()) errors.locality = 'Enter the locality.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.camp_date ?? ''))) errors.camp_date = 'Choose a date.';
  else if (b.camp_date < new Date().toISOString().slice(0, 10)) errors.camp_date = 'Camp date cannot be in the past.';
  if (!Number.isInteger(Number(b.capacity)) || Number(b.capacity) < 1) errors.capacity = 'Enter the donor capacity.';
  if (Object.keys(errors).length) return res.status(422).json({ error: 'validation', errors });

  db.prepare(
    `INSERT INTO camps (title,organiser,venue,locality,lat,lng,camp_date,start_time,end_time,bank_id,capacity)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(b.title.trim(), b.organiser.trim(), b.venue.trim(), b.locality.trim(),
        Number(b.lat) || 17.385, Number(b.lng) || 78.4867, b.camp_date,
        b.start_time ?? '09:00', b.end_time ?? '16:00', b.bank_id ?? null, Number(b.capacity));
  res.status(201).json({ ok: true });
});

ops.get('/admin/feedback', requireRole('admin'), (_req, res) => {
  res.json({
    feedback: db.prepare(
      `SELECT * FROM feedback ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, created_at DESC`
    ).all(),
  });
});

ops.post('/admin/feedback/:id', requireRole('admin'), (req, res) => {
  const { status } = req.body ?? {};
  if (!['new', 'read', 'actioned', 'closed'].includes(status)) {
    return res.status(422).json({ error: 'validation', errors: { status: 'Unknown status.' } });
  }
  db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

/** Any signed-in portal can post feedback; it lands in the admin inbox. */
ops.post('/feedback', requireRole('donor', 'requester', 'bank', 'admin'), (req, res) => {
  const { category, rating, message } = req.body ?? {};
  const errors: Record<string, string> = {};
  if (!category?.trim()) errors.category = 'Choose a category.';
  if (!message?.trim() || message.trim().length < 10) errors.message = 'Tell us a little more (at least 10 characters).';
  if (rating != null && (Number(rating) < 1 || Number(rating) > 5)) errors.rating = 'Rate between 1 and 5.';
  if (Object.keys(errors).length) return res.status(422).json({ error: 'validation', errors });

  db.prepare(
    'INSERT INTO feedback (source_portal,account_id,author_name,category,rating,message) VALUES (?,?,?,?,?,?)'
  ).run(req.account!.role, req.account!.id, req.account!.full_name, category.trim(),
        rating == null ? null : Number(rating), message.trim());
  res.status(201).json({ ok: true });
});

/** Raise a flag from any portal. */
ops.post('/flags', requireRole('donor', 'requester', 'bank', 'admin'), (req, res) => {
  const { request_id, donor_id, reason, detail } = req.body ?? {};
  const allowed = ['hoax', 'duplicate', 'abusive', 'payment_demand', 'wrong_details', 'other'];
  if (!allowed.includes(reason)) {
    return res.status(422).json({ error: 'validation', errors: { reason: 'Choose a reason.' } });
  }
  db.prepare(
    'INSERT INTO flags (request_id,donor_id,reason,detail,raised_by) VALUES (?,?,?,?,?)'
  ).run(request_id ?? null, donor_id ?? null, reason, detail ?? null, req.account!.full_name);
  emit('admin:flag', { reason });
  res.status(201).json({ ok: true });
});

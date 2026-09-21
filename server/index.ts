import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, sweepExpiry } from './db.js';
import { attachAccount, sweepSessions } from './lib/auth.js';
import { addClient, emit } from './lib/bus.js';
import { RADIUS_STAGES, STAGE_SECONDS, findCandidates } from './lib/domain.js';
import { core } from './routes/core.js';
import { requester } from './routes/requester.js';
import { ops } from './routes/ops.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4000);
const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(attachAccount);

/**
 * Low-bandwidth mode: ?lean=1 strips optional joined fields from any
 * array payload so the phone-on-2G path moves less over the wire.
 */
const LEAN_DROP = ['address', 'notes', 'descriptor', 'licence_no', 'user_agent', 'document_ref'];
app.use((req, res, next) => {
  if (req.query.lean !== '1') return next();
  const json = res.json.bind(res);
  res.json = (body: any) => {
    const strip = (v: any): any => {
      if (Array.isArray(v)) return v.map(strip);
      if (v && typeof v === 'object') {
        const out: any = {};
        for (const [k, val] of Object.entries(v)) if (!LEAN_DROP.includes(k)) out[k] = strip(val);
        return out;
      }
      return v;
    };
    return json(strip(body));
  };
  next();
});

app.use('/api', core);
app.use('/api', requester);
app.use('/api', ops);

// ---------------------------------------------------------------- SSE
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const remove = addClient(res, req.account?.role ?? 'anonymous', req.account?.id ?? null);
  req.on('close', remove);
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    donors: (db.prepare('SELECT COUNT(*) c FROM donors').get() as any).c,
    live_requests: (db.prepare("SELECT COUNT(*) c FROM requests WHERE status='broadcasting'").get() as any).c,
  });
});

// ---------------------------------------------------------------- errors
app.use('/api', (_req, res) => res.status(404).json({ error: 'no_such_endpoint' }));
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[api]', err);
  res.status(500).json({ error: 'server_error', message: 'Something broke on our side. Try again.' });
});

// ---------------------------------------------------------------- static (prod)
const dist = path.resolve(here, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

/**
 * Auto-escalation ticker. A live request that has sat at its current
 * radius longer than STAGE_SECONDS widens on its own and notifies the
 * newly reachable donors. This is what makes the widening visible
 * without anyone clicking.
 */
setInterval(() => {
  const due = db.prepare(
    `SELECT * FROM requests
     WHERE status IN ('broadcasting','partially_fulfilled')
       AND stage_started_at IS NOT NULL
       AND radius_stage < ?
       AND (julianday('now') - julianday(stage_started_at)) * 86400 >= ?`
  ).all(RADIUS_STAGES.length - 1, STAGE_SECONDS) as any[];

  for (const r of due) {
    const stage = r.radius_stage + 1;
    db.prepare("UPDATE requests SET radius_stage = ?, stage_started_at = datetime('now') WHERE id = ?")
      .run(stage, r.id);

    const already = db.prepare('SELECT donor_id FROM request_matches WHERE request_id = ?')
      .all(r.id).map((x: any) => x.donor_id);
    const fresh = findCandidates({
      lat: r.lat, lng: r.lng, bloodGroup: r.blood_group, component: r.component,
      radiusKm: RADIUS_STAGES[stage], excludeDonorIds: already,
    });
    const insM = db.prepare(
      'INSERT OR IGNORE INTO request_matches (request_id,donor_id,distance_km,radius_stage) VALUES (?,?,?,?)'
    );
    const insN = db.prepare(
      'INSERT INTO notifications (donor_id,kind,title,body,request_id) VALUES (?,?,?,?,?)'
    );
    db.transaction(() => {
      fresh.forEach((c) => {
        insM.run(r.id, c.id, c.distance_km, stage);
        insN.run(c.id, 'request', `${r.blood_group} request widened to ${RADIUS_STAGES[stage]} km`,
          `${r.units_needed} unit(s) still needed — ${c.distance_km} km direct`, r.id);
      });
    })();

    console.log(`[escalate] ${r.ref_code} -> ${RADIUS_STAGES[stage]} km, +${fresh.length} donor(s)`);
    emit('request:escalated', {
      requestId: r.id, ref: r.ref_code, stage,
      radius_km: RADIUS_STAGES[stage], notified: fresh.length, automatic: true,
    });
  }
}, 5_000).unref();

setInterval(() => { sweepSessions(); sweepExpiry(); }, 3600_000).unref();

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});

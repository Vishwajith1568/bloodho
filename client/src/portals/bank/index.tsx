import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import {
  Boxes, ArrowLeftRight, TimerReset, ClipboardList, Truck, Tent, ShieldCheck,
  MessageSquare, Plus, Minus, Trash2,
} from 'lucide-react';
import { post, useApi, useStream, ApiError, COMPONENT_LABEL, fmtDate, relTime } from '../../lib/api';
import {
  Shell, Field, GroupChip, StatusChip, UrgencyChip, VerifyChip,
  EmptyState, ErrorState, TableSkeleton, NavItem,
} from '../../components/ui';
import { useT } from '../../lib/i18n';
import FeedbackForm from '../Feedback';

const GROUPS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
const COMPONENTS = Object.keys(COMPONENT_LABEL);

export default function BankPortal({ lean, onLean }: any) {
  const { t } = useT();
  const { data: q } = useApi('/bank/requests');
  const pending = q?.claims?.filter((c: any) => c.status === 'pending').length ?? 0;

  const nav: NavItem[] = [
    { to: '/bank', label: t('nav.bank.inventory'), icon: Boxes },
    { to: '/bank/movements', label: t('nav.bank.movements'), icon: ArrowLeftRight },
    { to: '/bank/expiry', label: t('nav.bank.expiry'), icon: TimerReset },
    { to: '/bank/requests', label: t('nav.bank.queue'), icon: ClipboardList, badge: pending },
    { to: '/bank/verify', label: t('nav.bank.verify'), icon: ShieldCheck },
    { to: '/bank/transfers', label: t('nav.bank.transfers'), icon: Truck },
    { to: '/bank/camps', label: t('nav.bank.camps'), icon: Tent },
    { to: '/bank/feedback', label: t('nav.feedback'), icon: MessageSquare },
  ];
  const F = ({ title, children }: any) => (
    <Shell portal="bank" title={title} nav={nav} lean={lean} onLean={onLean} context={t('context.bank')}>
      {children}
    </Shell>
  );

  return (
    <Routes>
      <Route path="/" element={<F title={t('nav.bank.inventory')}><Inventory /></F>} />
      <Route path="movements" element={<F title={t('nav.bank.movements')}><Movements /></F>} />
      <Route path="expiry" element={<F title={t('nav.bank.expiry')}><Expiry /></F>} />
      <Route path="requests" element={<F title={t('nav.bank.queue')}><Queue /></F>} />
      <Route path="verify" element={<F title={t('nav.bank.verify')}><VerifyQueue /></F>} />
      <Route path="transfers" element={<F title={t('nav.bank.transfers')}><Transfers /></F>} />
      <Route path="camps" element={<F title={t('nav.bank.camps')}><CampEntry /></F>} />
      <Route path="feedback" element={<F title={t('nav.feedback')}><FeedbackForm portal="bank" /></F>} />
      <Route path="*" element={<F title={t('nav.bank.inventory')}><Inventory /></F>} />
    </Routes>
  );
}

/* ============================================================ inventory */
function Inventory() {
  const { data, loading, error, reload } = useApi('/bank/inventory');
  useStream(() => reload(), ['bank:stock']);

  if (loading && !data) return <div className="panel"><TableSkeleton rows={8} cols={5} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  const cell = (g: string, c: string) =>
    data.inventory.find((x: any) => x.blood_group === g && x.component === c);
  const colTotal = (c: string) =>
    data.inventory.filter((x: any) => x.component === c).reduce((s: number, x: any) => s + x.available, 0);

  return (
    <div className="stack">
      <div className="stats">
        <div className="stat"><span className="k">Units available</span>
          <span className="v">{data.totals.available ?? 0}</span></div>
        <div className="stat"><span className="k">Reserved</span>
          <span className="v">{data.totals.reserved ?? 0}</span></div>
        <div className="stat" data-tone="warn"><span className="k">Expired</span>
          <span className="v">{data.totals.expired ?? 0}</span></div>
        <div className="stat" data-tone="stop"><span className="k">Discarded</span>
          <span className="v">{data.totals.discarded ?? 0}</span></div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Stock by group and component</h3>
          <span className="small muted">{data.bank.name} · licence {data.bank.licence_no}</span>
        </div>
        <div className="panel-body flush">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                {COMPONENTS.map((c) => <th key={c} className="num">{COMPONENT_LABEL[c]}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => {
                const total = COMPONENTS.reduce((s, c) => s + (cell(g, c)?.available ?? 0), 0);
                return (
                  <tr key={g} data-urgent={total === 0}>
                    <td><GroupChip group={g} /></td>
                    {COMPONENTS.map((c) => {
                      const x = cell(g, c);
                      const n = x?.available ?? 0;
                      return (
                        <td key={c} className="num" style={{ color: n === 0 ? 'var(--faint)' : undefined }}>
                          {n}
                          {x?.expiring_soon > 0 && (
                            <span className="chip chip-warn" style={{ marginLeft: 6 }}
                              title={`${x.expiring_soon} unit(s) expire within 7 days`}>
                              {x.expiring_soon} soon
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="num" style={{ fontWeight: 600 }}>{total}</td>
                  </tr>
                );
              })}
              <tr style={{ background: 'var(--surface-alt)' }}>
                <td className="small muted">All groups</td>
                {COMPONENTS.map((c) => <td key={c} className="num" style={{ fontWeight: 600 }}>{colTotal(c)}</td>)}
                <td className="num" style={{ fontWeight: 600 }}>{data.totals.available ?? 0}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ============================================================ movements */
function Movements() {
  const { data, loading, error, reload } = useApi('/bank/movements');
  const [f, setF] = useState<any>({ kind: 'receipt', blood_group: 'O+', component: 'whole_blood', units: 1, counterparty: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: any) {
    e.preventDefault();
    setBusy(true); setErrors({}); setFailed(''); setDone('');
    try {
      await post('/bank/movements', { ...f, units: Number(f.units) });
      setDone(`${f.kind === 'receipt' ? 'Received' : f.kind === 'issue' ? 'Issued' : 'Discarded'} ${f.units} unit(s) of ${f.blood_group} ${COMPONENT_LABEL[f.component].toLowerCase()}.`);
      reload();
    } catch (err) {
      const e2 = err as ApiError;
      setErrors(e2.errors ?? {});
      if (e2.code === 'insufficient_stock') setFailed(e2.message);
    } finally { setBusy(false); }
  }

  const set = (k: string) => (e: any) => { setF({ ...f, [k]: e.target.value }); setDone(''); setFailed(''); };

  return (
    <div className="stack">
      <form className="panel" onSubmit={submit} noValidate>
        <div className="panel-head"><h3>Record a movement</h3></div>
        <div className="panel-body">
          {done && <div className="banner banner-ok" style={{ marginBottom: 16 }} role="status"><span>{done}</span></div>}
          {failed && <div className="banner banner-stop" style={{ marginBottom: 16 }} role="alert"><span>{failed}</span></div>}

          <fieldset style={{ marginBottom: 16 }}>
            <legend>Movement</legend>
            <div className="segmented">
              {[['receipt', 'Receipt in'], ['issue', 'Issue out'], ['discard', 'Discard']].map(([v, l]) => (
                <label key={v}>
                  <input type="radio" name="kind" checked={f.kind === v}
                    onChange={() => { setF({ ...f, kind: v }); setDone(''); setFailed(''); }} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid-3">
            <Field id="mg" label="Blood group" error={errors.blood_group}>
              <select id="mg" value={f.blood_group} onChange={set('blood_group')}>
                {GROUPS.map((g) => <option key={g}>{g}</option>)}
              </select>
            </Field>
            <Field id="mc" label="Component" error={errors.component}>
              <select id="mc" value={f.component} onChange={set('component')}>
                {COMPONENTS.map((c) => <option key={c} value={c}>{COMPONENT_LABEL[c]}</option>)}
              </select>
            </Field>
            <Field id="mu" label="Units" error={errors.units}>
              <input id="mu" className="num-input" type="number" min={1} value={f.units}
                aria-invalid={!!errors.units} onChange={set('units')} />
            </Field>
          </div>
          <div className="grid-2">
            <Field id="mcp" label={f.kind === 'issue' ? 'Issued to' : 'Received from'} hint="Hospital, camp or bank">
              <input id="mcp" value={f.counterparty} onChange={set('counterparty')} />
            </Field>
            <Field id="mn" label="Note" hint="Optional">
              <input id="mn" value={f.note} onChange={set('note')} />
            </Field>
          </div>
          <button className="btn btn-primary" disabled={busy}>
            {f.kind === 'receipt' ? <Plus size={14} aria-hidden /> : f.kind === 'issue'
              ? <Minus size={14} aria-hidden /> : <Trash2 size={14} aria-hidden />}
            {busy ? 'Recording…' : 'Record movement'}
          </button>
          <p className="small muted mt4 mb0">
            Issues and discards draw from the batch closest to expiry first.
          </p>
        </div>
      </form>

      <section className="panel">
        <div className="panel-head"><h3>Movement log</h3></div>
        <div className="panel-body flush">
          {loading && !data ? <TableSkeleton rows={6} cols={6} />
            : error ? <ErrorState error={error} retry={reload} />
            : data.movements.length === 0
              ? <EmptyState icon={ArrowLeftRight} title="No movements recorded"
                  body="Receipts, issues and discards appear here as an audit trail." />
              : (
                <table>
                  <thead><tr><th>When</th><th>Movement</th><th>Group</th><th>Component</th>
                    <th className="num">Units</th><th>Counterparty</th><th>Recorded by</th></tr></thead>
                  <tbody>
                    {data.movements.slice(0, 60).map((m: any) => (
                      <tr key={m.id}>
                        <td className="small muted">{relTime(m.created_at)}</td>
                        <td><StatusChip value={
                          m.kind === 'receipt' || m.kind === 'transfer_in' ? 'available'
                            : m.kind === 'discard' ? 'cancelled' : 'scheduled'
                        } label={m.kind.replace('_', ' ')} /></td>
                        <td><GroupChip group={m.blood_group} /></td>
                        <td>{COMPONENT_LABEL[m.component]}</td>
                        <td className="num">{m.units}</td>
                        <td className="muted">{m.counterparty ?? '—'}</td>
                        <td className="muted small">{m.actor ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
        </div>
      </section>
    </div>
  );
}

/* ============================================================ expiry */
function Expiry() {
  const { data, loading, error, reload } = useApi('/bank/expiry');
  if (loading && !data) return <div className="panel"><TableSkeleton rows={6} cols={5} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  return (
    <div className="stack">
      <div className="stats">
        <div className="stat" data-tone="warn"><span className="k">Batches expiring within 10 days</span>
          <span className="v">{data.expiring.length}</span></div>
        <div className="stat" data-tone="stop"><span className="k">Units wasted to date</span>
          <span className="v">{data.wastage.units}<small>in {data.wastage.batches} batches</small></span></div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Use these first</h3>
          <span className="small muted">Ordered by expiry date</span>
        </div>
        <div className="panel-body flush">
          {data.expiring.length === 0
            ? <EmptyState icon={TimerReset} title="Nothing expiring in the next ten days"
                body="Batches move into this list as they approach their expiry date." />
            : (
              <table>
                <thead><tr><th>Batch</th><th>Group</th><th>Component</th><th className="num">Units</th>
                  <th>Collected</th><th>Expires</th><th className="num">Days left</th><th>Source</th></tr></thead>
                <tbody>
                  {data.expiring.map((b: any) => (
                    <tr key={b.id} data-urgent={b.days_to_expiry <= 2}>
                      <td className="mono small">#{b.id}</td>
                      <td><GroupChip group={b.blood_group} /></td>
                      <td>{COMPONENT_LABEL[b.component]}</td>
                      <td className="num">{b.units}</td>
                      <td className="muted small">{fmtDate(b.collected_on)}</td>
                      <td className="small">{fmtDate(b.expires_on)}</td>
                      <td className="num">
                        <span className={'chip chip-' + (b.days_to_expiry <= 2 ? 'stop' : b.days_to_expiry <= 5 ? 'warn' : 'idle')}>
                          {b.days_to_expiry}
                        </span>
                      </td>
                      <td className="muted small">{b.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </section>
    </div>
  );
}

/* ============================================================ request queue */
function Queue() {
  const { data, loading, error, reload } = useApi('/bank/requests');
  const [busy, setBusy] = useState<number | null>(null);
  useStream(() => reload(), ['request:response', 'request:broadcast']);

  async function act(claim: any, action: string) {
    setBusy(claim.id);
    try {
      await post(`/bank/requests/${claim.id}`, {
        action, units: action === 'reject' ? 0 : claim.units_needed,
      });
      reload();
    } finally { setBusy(null); }
  }

  if (loading && !data) return <div className="panel"><TableSkeleton rows={4} cols={6} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Requests raised against this centre</h3>
        <span className="small muted">Critical first</span>
      </div>
      <div className="panel-body flush">
        {data.claims.length === 0
          ? <EmptyState icon={ClipboardList} title="Queue is clear"
              body="Requests routed to this blood bank land here for you to accept, reserve or reject." />
          : (
            <table>
              <thead>
                <tr><th>Reference</th><th>Patient</th><th>Group</th><th>Component</th>
                  <th className="num">Units</th><th>Hospital</th><th>Urgency</th>
                  <th>Verification</th><th>Your decision</th><th></th></tr>
              </thead>
              <tbody>
                {data.claims.map((c: any) => (
                  <tr key={c.id} data-urgent={c.urgency === 'critical' && c.status === 'pending'}>
                    <td className="mono small">{c.ref_code}</td>
                    <td className="mono small muted">{c.patient_ref}</td>
                    <td><GroupChip group={c.blood_group} /></td>
                    <td>{COMPONENT_LABEL[c.component]}</td>
                    <td className="num">{c.units_pledged}/{c.units_needed}</td>
                    <td className="muted">{c.hospital_name}</td>
                    <td><UrgencyChip value={c.urgency} /></td>
                    <td><VerifyChip state={c.verification_state} /></td>
                    <td><StatusChip value={c.status} /></td>
                    <td>
                      {c.status === 'pending' ? (
                        <div className="row" style={{ gap: 5 }}>
                          <button className="btn btn-sm btn-primary" disabled={busy === c.id}
                            onClick={() => act(c, 'accept')}>Accept</button>
                          <button className="btn btn-sm" disabled={busy === c.id}
                            onClick={() => act(c, 'reserve')}>Reserve</button>
                          <button className="btn btn-sm btn-danger" disabled={busy === c.id}
                            onClick={() => act(c, 'reject')}>Reject</button>
                        </div>
                      ) : <span className="faint small">{relTime(c.updated_at)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </section>
  );
}

/* ============================================================ verify queue */
function VerifyQueue() {
  const { data, loading, error, reload } = useApi('/bank/verification-queue');
  const [busy, setBusy] = useState<number | null>(null);
  useStream(() => reload(), ['hospital:review']);

  async function act(id: number, action: string) {
    setBusy(id);
    try { await post(`/bank/verification-queue/${id}`, { action }); reload(); }
    finally { setBusy(null); }
  }

  if (loading && !data) return <div className="panel"><TableSkeleton rows={3} cols={5} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Counter-verification</h3>
        <span className="small muted">Confirm the patient is actually admitted here</span>
      </div>
      <div className="panel-body flush">
        {data.queue.length === 0
          ? <EmptyState icon={ShieldCheck}
              title={data.note ? 'Not a hospital-attached centre' : 'Nothing awaiting counter-verification'}
              body={data.note ?? 'When an attendant submits a requisition reference for this hospital, it appears here for approval.'} />
          : (
            <table>
              <thead><tr><th>Reference</th><th>Requisition</th><th>Patient</th><th>Group</th>
                <th className="num">Units</th><th>Attendant</th><th>Raised</th><th></th></tr></thead>
              <tbody>
                {data.queue.map((r: any) => (
                  <tr key={r.id}>
                    <td className="mono small">{r.ref_code}</td>
                    <td className="mono small">{r.hospital_ref_no}</td>
                    <td className="mono small muted">{r.patient_ref}</td>
                    <td><GroupChip group={r.blood_group} /></td>
                    <td className="num">{r.units_needed}</td>
                    <td className="muted">{r.attendant_name}</td>
                    <td className="small muted">{relTime(r.created_at)}</td>
                    <td>
                      <div className="row" style={{ gap: 5 }}>
                        <button className="btn btn-sm btn-primary" disabled={busy === r.id}
                          onClick={() => act(r.id, 'approve')}>Approve</button>
                        <button className="btn btn-sm btn-danger" disabled={busy === r.id}
                          onClick={() => act(r.id, 'reject')}>Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </section>
  );
}

/* ============================================================ transfers */
function Transfers() {
  const { data, loading, error, reload } = useApi('/bank/transfers');
  const { data: meta } = useApi('/meta');
  const [f, setF] = useState<any>({ to_bank_id: '', blood_group: 'O-', component: 'prbc', units: 1, note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: any) {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      await post('/bank/transfers', { ...f, units: Number(f.units), to_bank_id: Number(f.to_bank_id) });
      setDone(true); reload();
    } catch (err) { setErrors((err as ApiError).errors ?? {}); }
    finally { setBusy(false); }
  }

  async function act(id: number, action: string) {
    await post(`/bank/transfers/${id}`, { action });
    reload();
  }

  const set = (k: string) => (e: any) => { setF({ ...f, [k]: e.target.value }); setDone(false); };

  return (
    <div className="stack">
      <form className="panel" onSubmit={submit} noValidate style={{ maxWidth: 720 }}>
        <div className="panel-head"><h3>Ask another centre for units</h3></div>
        <div className="panel-body">
          {done && <div className="banner banner-ok" style={{ marginBottom: 16 }} role="status">
            <span>Request sent. The receiving centre decides whether to release the units.</span></div>}
          <Field id="tb" label="Blood bank" error={errors.to_bank_id}>
            <select id="tb" value={f.to_bank_id} aria-invalid={!!errors.to_bank_id} onChange={set('to_bank_id')}>
              <option value="">Choose a centre</option>
              {meta?.banks?.map((b: any) => <option key={b.id} value={b.id}>{b.name} — {b.locality}</option>)}
            </select>
          </Field>
          <div className="grid-3">
            <Field id="tg" label="Blood group" error={errors.blood_group}>
              <select id="tg" value={f.blood_group} onChange={set('blood_group')}>
                {GROUPS.map((g) => <option key={g}>{g}</option>)}
              </select>
            </Field>
            <Field id="tc" label="Component" error={errors.component}>
              <select id="tc" value={f.component} onChange={set('component')}>
                {COMPONENTS.map((c) => <option key={c} value={c}>{COMPONENT_LABEL[c]}</option>)}
              </select>
            </Field>
            <Field id="tu" label="Units" error={errors.units}>
              <input id="tu" className="num-input" type="number" min={1} value={f.units}
                aria-invalid={!!errors.units} onChange={set('units')} />
            </Field>
          </div>
          <Field id="tn" label="Why" hint="Optional, helps the other centre prioritise">
            <input id="tn" value={f.note} onChange={set('note')} />
          </Field>
          <button className="btn btn-primary" disabled={busy}>
            <Truck size={14} aria-hidden /> {busy ? 'Sending…' : 'Send transfer request'}
          </button>
        </div>
      </form>

      {loading && !data ? <div className="panel"><TableSkeleton rows={4} cols={5} /></div>
        : error ? <ErrorState error={error} retry={reload} />
        : (
          <>
            <section className="panel">
              <div className="panel-head"><h3>Incoming — other centres asking us</h3></div>
              <div className="panel-body flush">
                {data.incoming.length === 0
                  ? <EmptyState icon={Truck} title="No incoming requests"
                      body="When another centre asks this one for units, it appears here to approve or reject." />
                  : (
                    <table>
                      <thead><tr><th>From</th><th>Group</th><th>Component</th><th className="num">Units</th>
                        <th>Note</th><th>Status</th><th></th></tr></thead>
                      <tbody>
                        {data.incoming.map((t: any) => (
                          <tr key={t.id}>
                            <td>{t.from_bank_name}</td>
                            <td><GroupChip group={t.blood_group} /></td>
                            <td>{COMPONENT_LABEL[t.component]}</td>
                            <td className="num">{t.units}</td>
                            <td className="muted small">{t.note ?? '—'}</td>
                            <td><StatusChip value={t.status} /></td>
                            <td>
                              <div className="row" style={{ gap: 5 }}>
                                {t.status === 'requested' && <>
                                  <button className="btn btn-sm btn-primary" onClick={() => act(t.id, 'approve')}>Approve</button>
                                  <button className="btn btn-sm btn-danger" onClick={() => act(t.id, 'reject')}>Reject</button>
                                </>}
                                {t.status === 'approved' &&
                                  <button className="btn btn-sm" onClick={() => act(t.id, 'complete')}>
                                    Mark handed over
                                  </button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head"><h3>Outgoing — what we asked for</h3></div>
              <div className="panel-body flush">
                {data.outgoing.length === 0
                  ? <EmptyState title="No outgoing requests" body="Transfer requests you raise are tracked here." />
                  : (
                    <table>
                      <thead><tr><th>To</th><th>Group</th><th>Component</th><th className="num">Units</th>
                        <th>Raised</th><th>Status</th></tr></thead>
                      <tbody>
                        {data.outgoing.map((t: any) => (
                          <tr key={t.id}>
                            <td>{t.to_bank_name}</td>
                            <td><GroupChip group={t.blood_group} /></td>
                            <td>{COMPONENT_LABEL[t.component]}</td>
                            <td className="num">{t.units}</td>
                            <td className="small muted">{relTime(t.created_at)}</td>
                            <td><StatusChip value={t.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </div>
            </section>
          </>
        )}
    </div>
  );
}

/* ============================================================ camp collection */
function CampEntry() {
  const { data, loading, error, reload } = useApi('/bank/camps');
  const [campId, setCampId] = useState('');
  const [lines, setLines] = useState<any[]>([{ blood_group: 'O+', component: 'whole_blood', units: 1 }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: any) {
    e.preventDefault();
    setBusy(true); setErrors({}); setDone('');
    try {
      await post('/bank/camp-collections', {
        camp_id: Number(campId),
        entries: lines.map((l) => ({ ...l, units: Number(l.units) })),
      });
      const total = lines.reduce((s, l) => s + Number(l.units), 0);
      setDone(`${total} unit(s) added to stock and logged against the camp.`);
      setLines([{ blood_group: 'O+', component: 'whole_blood', units: 1 }]);
      reload();
    } catch (err) { setErrors((err as ApiError).errors ?? {}); }
    finally { setBusy(false); }
  }

  const setLine = (i: number, k: string, v: any) =>
    setLines(lines.map((l, j) => (i === j ? { ...l, [k]: v } : l)));

  return (
    <div className="stack">
      <form className="panel" onSubmit={submit} noValidate>
        <div className="panel-head"><h3>Enter what a camp collected</h3></div>
        <div className="panel-body">
          {done && <div className="banner banner-ok" style={{ marginBottom: 16 }} role="status"><span>{done}</span></div>}
          <Field id="cc" label="Camp" error={errors.entries}>
            <select id="cc" value={campId} onChange={(e) => { setCampId(e.target.value); setDone(''); }}>
              <option value="">Choose a camp</option>
              {data?.camps?.map((c: any) => (
                <option key={c.id} value={c.id}>{c.title} — {fmtDate(c.camp_date)}</option>
              ))}
            </select>
          </Field>

          <div className="table-wrap" style={{ marginBottom: 16 }}>
            <table>
              <thead><tr><th>Group</th><th>Component</th><th className="num">Units</th><th></th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select value={l.blood_group} aria-label="Blood group"
                        onChange={(e) => setLine(i, 'blood_group', e.target.value)}>
                        {GROUPS.map((g) => <option key={g}>{g}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={l.component} aria-label="Component"
                        onChange={(e) => setLine(i, 'component', e.target.value)}>
                        {COMPONENTS.map((c) => <option key={c} value={c}>{COMPONENT_LABEL[c]}</option>)}
                      </select>
                    </td>
                    <td className="num">
                      <input className="num-input" type="number" min={1} value={l.units} aria-label="Units"
                        style={{ width: 80 }} onChange={(e) => setLine(i, 'units', e.target.value)} />
                    </td>
                    <td>
                      <button type="button" className="btn btn-sm btn-ghost" disabled={lines.length === 1}
                        onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row">
            <button type="button" className="btn btn-sm"
              onClick={() => setLines([...lines, { blood_group: 'O+', component: 'whole_blood', units: 1 }])}>
              <Plus size={14} aria-hidden /> Add a line
            </button>
            <button className="btn btn-primary" disabled={busy || !campId}>
              {busy ? 'Adding…' : 'Add to stock'}
            </button>
          </div>
        </div>
      </form>

      <section className="panel">
        <div className="panel-head"><h3>Camps and what they brought in</h3></div>
        <div className="panel-body flush">
          {loading && !data ? <TableSkeleton rows={3} cols={4} />
            : error ? <ErrorState error={error} retry={reload} />
            : data.camps.length === 0
              ? <EmptyState icon={Tent} title="No camps assigned" body="City control assigns camps to a collecting centre." />
              : (
                <table>
                  <thead><tr><th>Camp</th><th>Venue</th><th>Date</th><th>Status</th>
                    <th className="num">Units collected</th></tr></thead>
                  <tbody>
                    {data.camps.map((c: any) => (
                      <tr key={c.id}>
                        <td>{c.title}</td>
                        <td className="muted">{c.venue}</td>
                        <td>{fmtDate(c.camp_date)}</td>
                        <td><StatusChip value={c.status} /></td>
                        <td className="num">{c.units_collected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
        </div>
      </section>
    </div>
  );
}

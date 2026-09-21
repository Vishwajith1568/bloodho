import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import {
  BarChart3, BadgeCheck, Flag, Building2, CalendarPlus, Inbox as InboxIcon, Plus,
} from 'lucide-react';
import { post, patch, useApi, useStream, ApiError, fmtDate, relTime } from '../../lib/api';
import {
  Shell, Field, GroupChip, StatusChip, EmptyState, ErrorState, TableSkeleton, NavItem,
} from '../../components/ui';
import { useT } from '../../lib/i18n';

export default function AdminPortal({ lean, onLean }: any) {
  const { t } = useT();
  const { data: flags } = useApi('/admin/flags');
  const { data: fb } = useApi('/admin/feedback');
  const { data: vq } = useApi('/admin/verification-queue');
  const openFlags = flags?.flags?.filter((f: any) => f.status === 'open').length ?? 0;
  const newFb = fb?.feedback?.filter((f: any) => f.status === 'new').length ?? 0;
  const pendingV = vq?.queue?.filter((q: any) => q.status === 'pending').length ?? 0;

  const nav: NavItem[] = [
    { to: '/admin', label: t('nav.admin.metrics'), icon: BarChart3 },
    { to: '/admin/verification', label: t('nav.admin.verification'), icon: BadgeCheck, badge: pendingV },
    { to: '/admin/flags', label: t('nav.admin.flags'), icon: Flag, badge: openFlags },
    { to: '/admin/banks', label: t('nav.admin.banks'), icon: Building2 },
    { to: '/admin/camps', label: t('nav.admin.camps'), icon: CalendarPlus },
    { to: '/admin/feedback', label: t('nav.admin.feedback'), icon: InboxIcon, badge: newFb },
  ];
  const F = ({ title, children }: any) => (
    <Shell portal="admin" title={title} nav={nav} lean={lean} onLean={onLean}
      context={t('context.admin')}>{children}</Shell>
  );

  return (
    <Routes>
      <Route path="/" element={<F title={t('nav.admin.metrics')}><Metrics /></F>} />
      <Route path="verification" element={<F title={t('nav.admin.verification')}><Verification /></F>} />
      <Route path="flags" element={<F title={t('nav.admin.flags')}><Flags /></F>} />
      <Route path="banks" element={<F title={t('nav.admin.banks')}><Banks /></F>} />
      <Route path="camps" element={<F title={t('nav.admin.camps')}><CampSchedule /></F>} />
      <Route path="feedback" element={<F title={t('nav.admin.feedback')}><FeedbackInbox /></F>} />
      <Route path="*" element={<F title={t('nav.admin.metrics')}><Metrics /></F>} />
    </Routes>
  );
}

/* ============================================================ metrics */
function Metrics() {
  const { data: m, loading, error, reload } = useApi('/admin/metrics');
  useStream(() => reload(), ['request:response', 'bank:stock']);

  if (loading && !m) return <div className="panel"><TableSkeleton rows={4} cols={4} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  const hrs = m.median_fulfilment_minutes == null ? null
    : m.median_fulfilment_minutes >= 120
      ? `${(m.median_fulfilment_minutes / 60).toFixed(1)} hr`
      : `${m.median_fulfilment_minutes} min`;

  const totalDonations = m.donation_split.voluntary + m.donation_split.replacement;
  const volPct = totalDonations ? Math.round((m.donation_split.voluntary / totalDonations) * 100) : 0;

  return (
    <div className="stack">
      <div className="stats">
        <div className="stat"><span className="k">Median time to fulfil</span>
          <span className="v">{hrs ?? '—'}</span></div>
        <div className="stat" data-tone={m.fulfilment_rate != null && m.fulfilment_rate < 60 ? 'warn' : undefined}>
          <span className="k">Requests fulfilled</span>
          <span className="v">{m.fulfilment_rate ?? '—'}<small>%</small></span></div>
        <div className="stat" data-tone="stop"><span className="k">Units expired unused</span>
          <span className="v">{m.units_wasted.units}<small>in {m.units_wasted.batches} batches</small></span></div>
        <div className="stat"><span className="k">Donor retention</span>
          <span className="v">{m.donor_retention_rate ?? '—'}<small>%</small></span></div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h3>Voluntary against replacement</h3></div>
          <div className="panel-body">
            <div className="row" style={{ gap: 0, height: 26, borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ width: volPct + '%', background: 'var(--slate)', color: '#fff',
                display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 12 }}>
                {volPct}%
              </div>
              <div style={{ width: (100 - volPct) + '%', background: 'var(--crimson-wash)',
                color: 'var(--crimson-ink)', display: 'flex', alignItems: 'center',
                justifyContent: 'flex-end', paddingRight: 8, fontSize: 12 }}>
                {100 - volPct}%
              </div>
            </div>
            <table>
              <tbody>
                <tr><td>Voluntary donations</td><td className="num">{m.donation_split.voluntary}</td></tr>
                <tr><td>Replacement donations</td><td className="num">{m.donation_split.replacement}</td></tr>
              </tbody>
            </table>
            <p className="small muted mt4 mb0">
              Replacement donation is where the patient's family supplies a matching unit in exchange.
              A healthy register leans voluntary.
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Register and request load</h3></div>
          <div className="panel-body flush">
            <table>
              <tbody>
                <tr><td>Donors registered</td><td className="num">{m.donors.total}</td></tr>
                <tr><td>Accepting requests now</td><td className="num">{m.donors.available}</td></tr>
                <tr><td>Verified badge held</td><td className="num">{m.donors.verified}</td></tr>
                <tr><td>Requests raised</td><td className="num">{m.requests.total}</td></tr>
                <tr><td>Live right now</td><td className="num">{m.requests.live}</td></tr>
                <tr><td>Closed without fulfilment</td><td className="num">{m.requests.unfulfilled}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ============================================================ verification */
function Verification() {
  const { data, loading, error, reload } = useApi('/admin/verification-queue');
  const [busy, setBusy] = useState<number | null>(null);

  async function act(donorId: number, action: string) {
    setBusy(donorId);
    try { await post(`/admin/verification-queue/${donorId}`, { action }); reload(); }
    finally { setBusy(null); }
  }

  if (loading && !data) return <div className="panel"><TableSkeleton rows={4} cols={5} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  const pending = data.queue.filter((q: any) => q.status === 'pending');

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h3>Awaiting review</h3>
          <span className="small muted">{pending.length} donor{pending.length === 1 ? '' : 's'}</span>
        </div>
        <div className="panel-body flush">
          {pending.length === 0
            ? <EmptyState icon={BadgeCheck} title="Nothing awaiting review"
                body="Donors who submit an identity document for the verified badge appear here." />
            : (
              <table>
                <thead><tr><th>Donor</th><th>Group</th><th>Locality</th><th>Document</th>
                  <th className="num">Donations</th><th>Submitted</th><th></th></tr></thead>
                <tbody>
                  {pending.map((q: any) => (
                    <tr key={q.id}>
                      <td>{q.full_name}</td>
                      <td><GroupChip group={q.blood_group} /></td>
                      <td className="muted">{q.locality}</td>
                      <td className="small">{q.document_kind.replace('_', ' ')}
                        <span className="mono muted"> {q.document_ref}</span></td>
                      <td className="num">{q.total_donations}</td>
                      <td className="small muted">{relTime(q.created_at)}</td>
                      <td>
                        <div className="row" style={{ gap: 5 }}>
                          <button className="btn btn-sm btn-primary" disabled={busy === q.donor_id}
                            onClick={() => act(q.donor_id, 'award')}>Award badge</button>
                          <button className="btn btn-sm btn-danger" disabled={busy === q.donor_id}
                            onClick={() => act(q.donor_id, 'revoke')}>Reject</button>
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
        <div className="panel-head">
          <h3>Verified donors</h3>
          <span className="small muted">Revoke if a document turns out to be wrong</span>
        </div>
        <div className="panel-body flush">
          <table>
            <thead><tr><th>Donor</th><th>Group</th><th>Locality</th>
              <th className="num">Donations</th><th></th></tr></thead>
            <tbody>
              {data.verified.slice(0, 25).map((d: any) => (
                <tr key={d.id}>
                  <td>{d.full_name}</td>
                  <td><GroupChip group={d.blood_group} /></td>
                  <td className="muted">{d.locality}</td>
                  <td className="num">{d.total_donations}</td>
                  <td>
                    <button className="btn btn-sm btn-danger" disabled={busy === d.id}
                      onClick={() => act(d.id, 'revoke')}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ============================================================ flags */
function Flags() {
  const { data, loading, error, reload } = useApi('/admin/flags');
  const [busy, setBusy] = useState<number | null>(null);
  useStream(() => reload(), ['admin:flag']);

  async function act(id: number, action: string) {
    setBusy(id);
    try { await post(`/admin/flags/${id}`, { action }); reload(); }
    finally { setBusy(null); }
  }

  if (loading && !data) return <div className="panel"><TableSkeleton rows={4} cols={5} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  const open = data.flags.filter((f: any) => f.status === 'open');
  const closed = data.flags.filter((f: any) => f.status !== 'open');

  return (
    <div className="stack">
      {open.length > 0 && (
        <div className="banner banner-warn">
          <span>
            Upholding a flag cancels the request immediately and stops any further donor alerts.
          </span>
        </div>
      )}

      <section className="panel">
        <div className="panel-head"><h3>Open reports</h3></div>
        <div className="panel-body flush">
          {open.length === 0
            ? <EmptyState icon={Flag} title="No open reports"
                body="Donors, banks and attendants can report a request as a hoax, a duplicate or a demand for payment." />
            : (
              <table>
                <thead><tr><th>Raised by</th><th>Reason</th><th>Detail</th><th>Request</th>
                  <th>Subject</th><th>When</th><th></th></tr></thead>
                <tbody>
                  {open.map((f: any) => (
                    <tr key={f.id} data-urgent={f.reason === 'hoax'}>
                      <td>{f.raised_by}</td>
                      <td><StatusChip value={f.reason === 'hoax' ? 'cancelled' : 'pending'}
                        label={f.reason.replace('_', ' ')} /></td>
                      <td className="muted small" style={{ whiteSpace: 'normal', maxWidth: 320 }}>{f.detail}</td>
                      <td className="mono small">{f.ref_code ?? '—'}</td>
                      <td className="muted">{f.donor_name ?? f.patient_ref ?? '—'}</td>
                      <td className="small muted">{relTime(f.created_at)}</td>
                      <td>
                        <div className="row" style={{ gap: 5 }}>
                          <button className="btn btn-sm btn-danger" disabled={busy === f.id}
                            onClick={() => act(f.id, 'uphold')}>Uphold</button>
                          <button className="btn btn-sm" disabled={busy === f.id}
                            onClick={() => act(f.id, 'dismiss')}>Dismiss</button>
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
        <div className="panel-head"><h3>Resolved</h3></div>
        <div className="panel-body flush">
          {closed.length === 0
            ? <EmptyState title="Nothing resolved yet" body="Reports you uphold or dismiss move here." />
            : (
              <table>
                <thead><tr><th>Raised by</th><th>Reason</th><th>Request</th><th>Outcome</th><th>Resolved</th></tr></thead>
                <tbody>
                  {closed.map((f: any) => (
                    <tr key={f.id}>
                      <td>{f.raised_by}</td>
                      <td className="muted">{f.reason.replace('_', ' ')}</td>
                      <td className="mono small">{f.ref_code ?? '—'}</td>
                      <td><StatusChip value={f.status === 'upheld' ? 'cancelled' : 'available'}
                        label={f.status} /></td>
                      <td className="small muted">{relTime(f.resolved_at)}</td>
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

/* ============================================================ banks */
function Banks() {
  const { data, loading, error, reload } = useApi('/admin/banks');
  const [f, setF] = useState<any>({
    name: '', locality: '', address: '', lat: '17.3850', lng: '78.4867', phone: '', licence_no: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function submit(e: any) {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      await post('/admin/banks', f);
      setDone(true); setOpen(false);
      setF({ name: '', locality: '', address: '', lat: '17.3850', lng: '78.4867', phone: '', licence_no: '' });
      reload();
    } catch (err) { setErrors((err as ApiError).errors ?? {}); }
    finally { setBusy(false); }
  }

  const set = (k: string) => (e: any) => { setF({ ...f, [k]: e.target.value }); setDone(false); };

  return (
    <div className="stack">
      {done && <div className="banner banner-ok" role="status"><span>Blood bank onboarded and listed for requesters.</span></div>}

      <section className="panel">
        <div className="panel-head">
          <h3>Listed centres</h3>
          <button className="btn btn-sm btn-primary" onClick={() => setOpen(!open)}>
            <Plus size={14} aria-hidden /> Onboard a centre
          </button>
        </div>
        {open && (
          <form className="panel-body" onSubmit={submit} noValidate
            style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface-alt)' }}>
            <div className="grid-2">
              <Field id="bn" label="Registered name" error={errors.name}>
                <input id="bn" value={f.name} aria-invalid={!!errors.name} onChange={set('name')} />
              </Field>
              <Field id="bl" label="Locality" error={errors.locality}>
                <input id="bl" value={f.locality} aria-invalid={!!errors.locality} onChange={set('locality')} />
              </Field>
            </div>
            <Field id="ba" label="Address">
              <input id="ba" value={f.address} onChange={set('address')} />
            </Field>
            <div className="grid-3">
              <Field id="bp" label="Phone" error={errors.phone}>
                <input id="bp" className="num-input" value={f.phone} aria-invalid={!!errors.phone} onChange={set('phone')} />
              </Field>
              <Field id="blic" label="Drug licence number" error={errors.licence_no}>
                <input id="blic" value={f.licence_no} aria-invalid={!!errors.licence_no} onChange={set('licence_no')} />
              </Field>
              <div className="grid-2">
                <Field id="blat" label="Latitude" error={errors.lat}>
                  <input id="blat" className="num-input" value={f.lat} onChange={set('lat')} />
                </Field>
                <Field id="blng" label="Longitude">
                  <input id="blng" className="num-input" value={f.lng} onChange={set('lng')} />
                </Field>
              </div>
            </div>
            <div className="row">
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Onboard centre'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        )}
        <div className="panel-body flush">
          {loading && !data ? <TableSkeleton rows={6} cols={5} />
            : error ? <ErrorState error={error} retry={reload} />
            : (
              <table>
                <thead><tr><th>Centre</th><th>Locality</th><th>Licence</th><th>Phone</th>
                  <th className="num">Units held</th><th>Listing</th><th></th></tr></thead>
                <tbody>
                  {data.banks.map((b: any) => (
                    <tr key={b.id}>
                      <td>{b.name}</td>
                      <td className="muted">{b.locality}</td>
                      <td className="mono small">{b.licence_no}</td>
                      <td className="mono small">{b.phone}</td>
                      <td className="num">{b.units_available}</td>
                      <td><StatusChip value={b.is_active ? 'available' : 'unavailable'}
                        label={b.is_active ? 'Listed' : 'Delisted'} /></td>
                      <td>
                        <button className={'btn btn-sm' + (b.is_active ? ' btn-danger' : '')}
                          onClick={() => patch(`/admin/banks/${b.id}`, { is_active: !b.is_active }).then(reload)}>
                          {b.is_active ? 'Delist' : 'Relist'}
                        </button>
                      </td>
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

/* ============================================================ camps */
function CampSchedule() {
  const { data, loading, error, reload } = useApi('/admin/camps');
  const { data: meta } = useApi('/meta');
  const [f, setF] = useState<any>({
    title: '', organiser: '', venue: '', locality: '', camp_date: '',
    start_time: '09:30', end_time: '16:00', bank_id: '', capacity: 100,
    lat: '17.3850', lng: '78.4867',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: any) {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      await post('/admin/camps', { ...f, capacity: Number(f.capacity), bank_id: f.bank_id || null });
      setDone(true); reload();
      setF({ ...f, title: '', organiser: '', venue: '', locality: '', camp_date: '' });
    } catch (err) { setErrors((err as ApiError).errors ?? {}); }
    finally { setBusy(false); }
  }

  const set = (k: string) => (e: any) => { setF({ ...f, [k]: e.target.value }); setDone(false); };

  return (
    <div className="stack">
      <form className="panel" onSubmit={submit} noValidate>
        <div className="panel-head"><h3>Schedule a camp</h3></div>
        <div className="panel-body">
          {done && <div className="banner banner-ok" style={{ marginBottom: 16 }} role="status">
            <span>Camp scheduled. Donors can register for it from their portal now.</span></div>}
          <div className="grid-2">
            <Field id="ct" label="Camp title" error={errors.title}>
              <input id="ct" value={f.title} aria-invalid={!!errors.title} onChange={set('title')} />
            </Field>
            <Field id="co" label="Organiser" error={errors.organiser}>
              <input id="co" value={f.organiser} aria-invalid={!!errors.organiser} onChange={set('organiser')} />
            </Field>
          </div>
          <div className="grid-2">
            <Field id="cv" label="Venue" error={errors.venue}>
              <input id="cv" value={f.venue} aria-invalid={!!errors.venue} onChange={set('venue')} />
            </Field>
            <Field id="cl" label="Locality" error={errors.locality}>
              <input id="cl" value={f.locality} aria-invalid={!!errors.locality} onChange={set('locality')} />
            </Field>
          </div>
          <div className="grid-3">
            <Field id="cd" label="Date" error={errors.camp_date}>
              <input id="cd" type="date" value={f.camp_date} aria-invalid={!!errors.camp_date} onChange={set('camp_date')} />
            </Field>
            <div className="grid-2">
              <Field id="cs" label="From"><input id="cs" type="time" value={f.start_time} onChange={set('start_time')} /></Field>
              <Field id="ce" label="To"><input id="ce" type="time" value={f.end_time} onChange={set('end_time')} /></Field>
            </div>
            <Field id="ccap" label="Donor capacity" error={errors.capacity}>
              <input id="ccap" className="num-input" type="number" min={1} value={f.capacity}
                aria-invalid={!!errors.capacity} onChange={set('capacity')} />
            </Field>
          </div>
          <Field id="cb" label="Collecting centre" hint="Units collected are added to this centre's stock">
            <select id="cb" value={f.bank_id} onChange={set('bank_id')}>
              <option value="">Assign later</option>
              {meta?.banks?.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <button className="btn btn-primary" disabled={busy}>
            <CalendarPlus size={14} aria-hidden /> {busy ? 'Scheduling…' : 'Schedule camp'}
          </button>
        </div>
      </form>

      <section className="panel">
        <div className="panel-head"><h3>Camps across the city</h3></div>
        <div className="panel-body flush">
          {loading && !data ? <TableSkeleton rows={4} cols={6} />
            : error ? <ErrorState error={error} retry={reload} />
            : data.camps.length === 0
              ? <EmptyState icon={CalendarPlus} title="No camps scheduled" body="Use the form above to publish the first one." />
              : (
                <table>
                  <thead><tr><th>Camp</th><th>Venue</th><th>Date</th><th>Collecting centre</th>
                    <th className="num">Registered</th><th className="num">Units collected</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.camps.map((c: any) => (
                      <tr key={c.id}>
                        <td><strong style={{ fontWeight: 500 }}>{c.title}</strong>
                          <div className="small muted">{c.organiser}</div></td>
                        <td className="muted">{c.venue}<div className="small">{c.locality}</div></td>
                        <td>{fmtDate(c.camp_date)}<div className="small muted mono">{c.start_time}–{c.end_time}</div></td>
                        <td className="muted">{c.bank_name ?? <span className="faint">Unassigned</span>}</td>
                        <td className="num">{c.registered}/{c.capacity}</td>
                        <td className="num">{c.units_collected}</td>
                        <td><StatusChip value={c.status} /></td>
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

/* ============================================================ feedback */
function FeedbackInbox() {
  const { data, loading, error, reload } = useApi('/admin/feedback');
  const [filter, setFilter] = useState('all');

  if (loading && !data) return <div className="panel"><TableSkeleton rows={5} cols={5} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  const rows = filter === 'all' ? data.feedback : data.feedback.filter((f: any) => f.source_portal === filter);

  return (
    <div className="stack">
      <div className="row wrap">
        <div className="segmented" style={{ maxWidth: 420 }}>
          {[['all', 'All portals'], ['donor', 'Donor'], ['requester', 'Requester'], ['bank', 'Blood bank']].map(([v, l]) => (
            <label key={v}>
              <input type="radio" name="fbf" checked={filter === v} onChange={() => setFilter(v)} />
              <span>{l}</span>
            </label>
          ))}
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Feedback</h3>
          <span className="small muted">{rows.length} message{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div className="panel-body flush">
          {rows.length === 0
            ? <EmptyState icon={InboxIcon} title="Nothing from this portal yet"
                body="Messages sent from the donor, requester and blood bank portals collect here." />
            : (
              <table>
                <thead><tr><th>From</th><th>Portal</th><th>Topic</th><th className="num">Rating</th>
                  <th>Message</th><th>When</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {rows.map((f: any) => (
                    <tr key={f.id} data-urgent={f.status === 'new' && f.rating != null && f.rating <= 2}>
                      <td>{f.author_name}</td>
                      <td><StatusChip value={
                        f.source_portal === 'donor' ? 'available'
                          : f.source_portal === 'bank' ? 'scheduled' : 'pending'
                      } label={f.source_portal} /></td>
                      <td className="muted">{f.category}</td>
                      <td className="num">{f.rating ?? '—'}</td>
                      <td style={{ whiteSpace: 'normal', maxWidth: 380 }}>{f.message}</td>
                      <td className="small muted">{relTime(f.created_at)}</td>
                      <td><StatusChip value={f.status === 'new' ? 'pending' : 'available'} label={f.status} /></td>
                      <td>
                        {f.status !== 'closed' && (
                          <button className="btn btn-sm"
                            onClick={() => post(`/admin/feedback/${f.id}`, {
                              status: f.status === 'new' ? 'read' : f.status === 'read' ? 'actioned' : 'closed',
                            }).then(reload)}>
                            {f.status === 'new' ? 'Mark read' : f.status === 'read' ? 'Mark actioned' : 'Close'}
                          </button>
                        )}
                      </td>
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

import { useEffect, useMemo, useState } from 'react';
import { Routes, Route, useNavigate, useParams, Link } from 'react-router-dom';
import {
  Siren, Activity, Building2, History, ShieldCheck, Radio, Phone, ArrowRight, Users, MessageSquare,
} from 'lucide-react';
import {
  post, useApi, useStream, ApiError, COMPONENT_LABEL, fmtDate, relTime, fmtTime,
} from '../../lib/api';
import {
  Shell, Field, GroupChip, StatusChip, UrgencyChip, VerifyChip,
  EmptyState, ErrorState, TableSkeleton, NavItem,
} from '../../components/ui';
import { useT } from '../../lib/i18n';
import FeedbackForm from '../Feedback';

const GROUPS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];

export default function RequesterPortal({ lean, onLean }: { lean: boolean; onLean: (v: boolean) => void }) {
  const { t } = useT();
  const { data: live } = useApi('/requests');
  const openCount = live?.requests?.filter((r: any) =>
    ['broadcasting', 'partially_fulfilled'].includes(r.status)).length ?? 0;

  const nav: NavItem[] = [
    { to: '/request/new', label: t('nav.requester.new'), icon: Siren },
    { to: '/request/active', label: t('nav.requester.active'), icon: Activity, badge: openCount },
    { to: '/request/banks', label: t('nav.requester.banks'), icon: Building2 },
    { to: '/request/history', label: t('nav.requester.history'), icon: History },
    { to: '/request/feedback', label: t('nav.feedback'), icon: MessageSquare },
  ];

  return (
    <Routes>
      <Route path="new" element={<Frame nav={nav} title={t('nav.requester.new')} lean={lean} onLean={onLean}><NewRequest /></Frame>} />
      <Route path="active" element={<Frame nav={nav} title={t('nav.requester.active')} lean={lean} onLean={onLean}><ActiveList /></Frame>} />
      <Route path="track/:id" element={<Frame nav={nav} title={t('nav.requester.track')} lean={lean} onLean={onLean}><Tracker /></Frame>} />
      <Route path="banks" element={<Frame nav={nav} title={t('nav.requester.banks')} lean={lean} onLean={onLean}><BankSearch /></Frame>} />
      <Route path="history" element={<Frame nav={nav} title={t('nav.requester.history')} lean={lean} onLean={onLean}><HistoryList /></Frame>} />
      <Route path="feedback" element={<Frame nav={nav} title={t('nav.feedback')} lean={lean} onLean={onLean}><FeedbackForm portal="requester" /></Frame>} />
      <Route path="*" element={<Frame nav={nav} title={t('nav.requester.new')} lean={lean} onLean={onLean}><NewRequest /></Frame>} />
    </Routes>
  );
}

function Frame({ nav, title, children, lean, onLean }: any) {
  const { t } = useT();
  return (
    <Shell portal="requester" title={title} nav={nav} lean={lean} onLean={onLean}
      context={t('context.requester')}>
      {children}
    </Shell>
  );
}

/* ============================================================ SOS form */
function NewRequest() {
  const { t } = useT();
  const nav = useNavigate();
  const { data: meta } = useApi('/meta');
  const [f, setF] = useState<any>({
    blood_group: '', component: 'whole_blood', units_needed: 1, urgency: 'critical',
    hospital_id: '', ward: '', patient_ref: '', patient_age: '',
    attendant_name: '', attendant_phone: '', notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF((s: any) => ({ ...s, [k]: e.target.value }));

  async function submit(e: any) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post('/requests', {
        ...f,
        units_needed: Number(f.units_needed),
        patient_age: f.patient_age === '' ? null : Number(f.patient_age),
        hospital_id: Number(f.hospital_id),
      });
      nav(`/request/track/${r.request.id}`);
    } catch (err) {
      const e2 = err as ApiError;
      setErrors(e2.errors ?? {});
      const first = document.querySelector('[aria-invalid="true"]') as HTMLElement | null;
      first?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 780 }}>
      <header>
        <p>
{t('sos.intro')}
        </p>
      </header>

      <form onSubmit={submit} noValidate className="stack">
        <section className="panel">
          <div className="panel-head"><h3>{t('sos.section.patient')}</h3></div>
          <div className="panel-body">
            <fieldset style={{ marginBottom: 16 }}>
              <legend>{t('sos.bloodGroup')}</legend>
              <div className="group-grid" role="radiogroup" aria-invalid={!!errors.blood_group}>
                {GROUPS.map((g) => (
                  <label key={g}>
                    <input type="radio" name="blood_group" value={g}
                      checked={f.blood_group === g}
                      onChange={() => setF((s: any) => ({ ...s, blood_group: g }))} />
                    {g}
                  </label>
                ))}
              </div>
              {errors.blood_group && <span className="err" role="alert">{errors.blood_group}</span>}
            </fieldset>

            <fieldset style={{ marginBottom: 16 }}>
              <legend>{t('sos.component')}</legend>
              <div className="segmented">
                {Object.keys(COMPONENT_LABEL).map((v) => (
                  <label key={v}>
                    <input type="radio" name="component" value={v}
                      checked={f.component === v}
                      onChange={() => setF((s: any) => ({ ...s, component: v }))} />
                    <span>{t(`component.${v}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid-2">
              <Field id="units" label={t('sos.units')} error={errors.units_needed}>
                <input id="units" className="num-input" type="number" min={1} max={10}
                  value={f.units_needed} aria-invalid={!!errors.units_needed}
                  onChange={set('units_needed')} />
              </Field>
              <fieldset>
                <legend>{t('sos.urgency')}</legend>
                <div className="segmented urgent">
                  {['critical', 'urgent', 'scheduled'].map((v) => (
                    <label key={v}>
                      <input type="radio" name="urgency" value={v} checked={f.urgency === v}
                        onChange={() => setF((s: any) => ({ ...s, urgency: v }))} />
                      <span>{t(`urgency.${v}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>{t('sos.section.hospital')}</h3></div>
          <div className="panel-body">
            <Field id="hospital" label={t('sos.hospital')} error={errors.hospital_id}>
              <select id="hospital" value={f.hospital_id} aria-invalid={!!errors.hospital_id}
                onChange={set('hospital_id')}>
                <option value="">{t('sos.hospitalPlaceholder')}</option>
                {meta?.hospitals?.map((h: any) => (
                  <option key={h.id} value={h.id}>{h.name} — {h.locality}</option>
                ))}
              </select>
            </Field>
            <div className="grid-2">
              <Field id="ward" label={t('sos.ward')} hint={t('sos.wardHint')}>
                <input id="ward" value={f.ward} onChange={set('ward')} placeholder="ICU-2" />
              </Field>
              <Field id="pref" label={t('sos.patientRef')} error={errors.patient_ref}>
                <input id="pref" value={f.patient_ref} aria-invalid={!!errors.patient_ref}
                  onChange={set('patient_ref')} placeholder="IP/2026/15201" />
              </Field>
            </div>
            <Field id="age" label={t('sos.patientAge')} hint={t('sos.optional')}>
              <input id="age" className="num-input" type="number" min={0} max={120}
                value={f.patient_age} onChange={set('patient_age')} style={{ maxWidth: 120 }} />
            </Field>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>{t('sos.section.attendant')}</h3></div>
          <div className="panel-body">
            <div className="grid-2">
              <Field id="aname" label={t('sos.attendantName')} error={errors.attendant_name}>
                <input id="aname" value={f.attendant_name} aria-invalid={!!errors.attendant_name}
                  onChange={set('attendant_name')} />
              </Field>
              <Field id="aphone" label={t('sos.attendantPhone')} error={errors.attendant_phone}
                hint={t('sos.attendantPhoneHint')}>
                <input id="aphone" className="num-input" inputMode="numeric" maxLength={10}
                  value={f.attendant_phone} aria-invalid={!!errors.attendant_phone}
                  onChange={set('attendant_phone')} />
              </Field>
            </div>
            <Field id="notes" label={t('sos.notes')} hint={t('sos.optional')}>
              <textarea id="notes" rows={2} value={f.notes} onChange={set('notes')} />
            </Field>
          </div>
        </section>

        <div className="row">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? t('sos.submitting') : t('sos.submit')} <ArrowRight size={15} aria-hidden />
          </button>
          <span className="small muted">{t('sos.nothingSent')}</span>
        </div>
      </form>
    </div>
  );
}

/* ============================================================ tracker */
function Tracker() {
  const { id } = useParams();
  const { data, loading, error, reload } = useApi(`/requests/${id}/tracker`, [id]);
  const [tick, setTick] = useState(0);

  useStream(() => reload(), ['request:escalated', 'request:response', 'request:verification']);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(reload, 10000); return () => clearInterval(t); }, [reload]);

  if (loading && !data) return <div className="panel"><TableSkeleton rows={6} cols={5} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  const { request: r, hospital, matches, summary, radius, bank_claims } = data;
  const canBroadcast = r.verification_state !== 'unverified' && r.status === 'draft';

  return (
    <div className="stack">
      <header className="row-between wrap">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <h2 className="mono">{r.ref_code}</h2>
            <GroupChip group={r.blood_group} />
            <UrgencyChip value={r.urgency} />
            <VerifyChip state={r.verification_state} />
            <StatusChip value={r.status} />
          </div>
          <p className="muted mb0">
            {r.units_needed} unit{r.units_needed > 1 ? 's' : ''} of {COMPONENT_LABEL[r.component]} ·{' '}
            {hospital.name}, {hospital.locality}{r.ward ? ` · ${r.ward}` : ''} · raised {relTime(r.created_at)}
          </p>
        </div>
      </header>

      {r.verification_state === 'unverified' && <VerifyStep request={r} onDone={reload} />}

      {canBroadcast && (
        <div className="banner banner-ok row-between">
          <span><strong>Verified.</strong> Donors within 5 km can be alerted now; the radius widens
            on its own if nobody responds.</span>
          <button className="btn btn-primary btn-sm"
            onClick={() => post(`/requests/${r.id}/broadcast`).then(reload)}>
            <Radio size={14} aria-hidden /> Alert donors
          </button>
        </div>
      )}

      {(r.status === 'broadcasting' || r.status === 'partially_fulfilled') && (
        <RadiusTrack radius={radius} requestId={r.id} onEscalate={reload} tick={tick} />
      )}

      <div className="stats">
        <div className="stat"><span className="k">Donors notified</span>
          <span className="v">{summary.notified}</span></div>
        <div className="stat" data-tone={summary.accepted ? undefined : 'warn'}>
          <span className="k">Accepted</span><span className="v">{summary.accepted}</span></div>
        <div className="stat"><span className="k">Declined</span>
          <span className="v">{summary.declined}</span></div>
        <div className="stat" data-tone={summary.units_pledged < summary.units_needed ? 'stop' : undefined}>
          <span className="k">Units pledged</span>
          <span className="v">{summary.units_pledged}<small>of {summary.units_needed}</small></span></div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Donors alerted</h3>
          <span className="small muted">Numbers stay hidden until a donor accepts</span>
        </div>
        <div className="panel-body flush">
          {matches.length === 0 ? (
            r.status === 'draft'
              ? <EmptyState icon={Radio} title="Not broadcast yet"
                  body="Once verified, alerting donors will list everyone contacted here, nearest first." />
              : <EmptyState icon={Users} title="No donor has responded yet"
                  body={`Nobody eligible was found inside ${radius.km} km. The radius widens automatically, or you can widen it now.`}
                  action={!radius.at_max && (
                    <button className="btn btn-sm" onClick={() => post(`/requests/${r.id}/escalate`).then(reload)}>
                      Widen the search now
                    </button>)} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Donor</th><th>Group</th><th className="num">Distance</th>
                  <th>Locality</th><th>Alerted</th><th>Response</th><th>Contact</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m: any) => (
                  <tr key={m.id} data-urgent={m.response === 'accepted'}>
                    <td>{m.full_name}</td>
                    <td><GroupChip group={m.blood_group} /></td>
                    <td className="num">{m.distance_km.toFixed(1)} km</td>
                    <td className="muted">{m.locality}</td>
                    <td className="muted small">{relTime(m.notified_at)}</td>
                    <td><StatusChip value={m.response} /></td>
                    <td className={m.response === 'accepted' ? 'mono' : 'faint small'}>
                      {m.response === 'accepted'
                        ? <span className="row" style={{ gap: 5 }}><Phone size={13} aria-hidden />{m.phone}</span>
                        : 'Hidden'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {bank_claims?.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h3>Blood banks contacted</h3></div>
          <div className="panel-body flush">
            <table>
              <thead><tr><th>Blood bank</th><th>Locality</th><th>Status</th>
                <th className="num">Units held</th><th>Note</th><th>Phone</th></tr></thead>
              <tbody>
                {bank_claims.map((b: any) => (
                  <tr key={b.id}>
                    <td>{b.bank_name}</td>
                    <td className="muted">{b.locality}</td>
                    <td><StatusChip value={b.status} /></td>
                    <td className="num">{b.units}</td>
                    <td className="muted small">{b.note ?? '—'}</td>
                    <td className="mono small">{b.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/* ---- verification step ---- */
function VerifyStep({ request, onDone }: any) {
  const [sent, setSent] = useState<any>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!sent) return;
    setLeft(sent.expires_in_seconds);
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [sent]);

  async function send() {
    setBusy(true); setError('');
    try { setSent(await post(`/requests/${request.id}/otp/send`)); }
    catch (e) { setError((e as ApiError).message); }
    finally { setBusy(false); }
  }

  async function verify(e: any) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await post(`/requests/${request.id}/otp/verify`, { code }); onDone(); }
    catch (err) { setError((err as ApiError).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h3><ShieldCheck size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Verify before broadcasting</h3>
      </div>
      <div className="panel-body">
        <div className="banner banner-stop" style={{ marginBottom: 16 }}>
          <span>
            <strong>This request cannot reach donors yet.</strong> Unverified requests are never
            broadcast city-wide — it is how hoax calls are kept out.
          </span>
        </div>

        {!sent ? (
          <div className="row wrap">
            <button className="btn btn-primary" onClick={send} disabled={busy}>
              {busy ? 'Sending…' : `Send code to ${request.attendant_phone}`}
            </button>
            <span className="small muted">or ask the ward to counter-verify from the hospital portal</span>
          </div>
        ) : (
          <form onSubmit={verify} className="stack" style={{ maxWidth: 360 }}>
            <div className="devstrip">
              <span>No SMS gateway offline — code for this demo:</span>
              <span className="code">{sent.dev_code}</span>
            </div>
            <Field id="otp" label={`Code sent to ${sent.sent_to}`} error={error}
              hint={left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired — send a new code'}>
              <input id="otp" className="num-input" inputMode="numeric" maxLength={6}
                value={code} aria-invalid={!!error} onChange={(e) => setCode(e.target.value)}
                style={{ maxWidth: 140, fontSize: 19, letterSpacing: '0.18em' }} />
            </Field>
            <div className="row">
              <button className="btn btn-primary" disabled={busy || code.length !== 6}>Verify</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={send}>Send a new code</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

/* ---- radius timer ---- */
function RadiusTrack({ radius, requestId, onEscalate, tick }: any) {
  const pct = radius.seconds_to_next == null ? 100
    : Math.min(100, ((radius.seconds_per_stage - radius.seconds_to_next) / radius.seconds_per_stage) * 100);

  return (
    <section>
      <div className="row-between wrap" style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 'var(--t-base)' }}>Search radius</h3>
        {radius.at_max
          ? <span className="small muted">Widest radius reached — every eligible donor in the city has been alerted.</span>
          : <div className="row">
              <span className="small muted">
                Widens to {radius.stages[radius.stage + 1]} km in{' '}
                <span className="mono">{radius.seconds_to_next ?? 0}s</span>
              </span>
              <button className="btn btn-sm" onClick={() => post(`/requests/${requestId}/escalate`).then(onEscalate)}>
                Widen now
              </button>
            </div>}
      </div>
      <div className="radius-track">
        {radius.stages.map((km: number, i: number) => (
          <div key={km} className="radius-step"
            data-state={i < radius.stage ? 'done' : i === radius.stage ? 'active' : 'pending'}>
            <span className="km">{km} km</span>
            <span className="lbl">
              {i < radius.stage ? 'searched' : i === radius.stage ? 'searching now' : 'next if needed'}
            </span>
            {i === radius.stage && <div className="radius-fill" style={{ width: pct + '%' }} />}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================ lists */
function RequestTable({ rows }: { rows: any[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Reference</th><th>Group</th><th>Component</th><th className="num">Units</th>
          <th>Hospital</th><th>Urgency</th><th>Verification</th><th>Status</th>
          <th className="num">Alerted</th><th>Raised</th><th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} data-urgent={r.urgency === 'critical' && r.status === 'broadcasting'}>
            <td className="mono small">{r.ref_code}</td>
            <td><GroupChip group={r.blood_group} /></td>
            <td>{COMPONENT_LABEL[r.component]}</td>
            <td className="num">{r.units_pledged}/{r.units_needed}</td>
            <td className="muted">{r.hospital_name}</td>
            <td><UrgencyChip value={r.urgency} /></td>
            <td><VerifyChip state={r.verification_state} /></td>
            <td><StatusChip value={r.status} /></td>
            <td className="num">{r.notified}</td>
            <td className="muted small" title={`${fmtDate(r.created_at)} ${fmtTime(r.created_at)}`}>
              {relTime(r.created_at)}
            </td>
            <td><Link className="small" to={`/request/track/${r.id}`}>Open</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ActiveList() {
  const { data, loading, error, reload } = useApi('/requests');
  useStream(() => reload(), ['request:response', 'request:escalated']);
  if (loading && !data) return <div className="table-wrap"><TableSkeleton rows={4} cols={6} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;
  const rows = data.requests.filter((r: any) =>
    ['draft', 'broadcasting', 'partially_fulfilled'].includes(r.status));
  return (
    <div className="panel">
      <div className="panel-head"><h3>Open requests</h3>
        <span className="small muted">{rows.length} of {data.requests.length} shown</span></div>
      <div className="panel-body flush">
        {rows.length === 0
          ? <EmptyState icon={Siren} title="No open requests"
              body="Nothing is waiting on donors right now."
              action={<Link className="btn btn-sm btn-primary" to="/request/new">Raise a request</Link>} />
          : <RequestTable rows={rows} />}
      </div>
    </div>
  );
}

function HistoryList() {
  const { data, loading, error, reload } = useApi('/requests');
  if (loading && !data) return <div className="table-wrap"><TableSkeleton rows={6} cols={6} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;
  const rows = data.requests.filter((r: any) =>
    ['fulfilled', 'cancelled', 'expired'].includes(r.status));
  return (
    <div className="panel">
      <div className="panel-head"><h3>Closed requests</h3></div>
      <div className="panel-body flush">
        {rows.length === 0
          ? <EmptyState title="Nothing closed yet" body="Fulfilled, cancelled and expired requests collect here." />
          : <RequestTable rows={rows} />}
      </div>
    </div>
  );
}

/* ============================================================ bank search */
function BankSearch() {
  const { data: meta } = useApi('/meta');
  const [group, setGroup] = useState('O+');
  const [component, setComponent] = useState('whole_blood');
  const [hospitalId, setHospitalId] = useState('');

  useEffect(() => {
    if (!hospitalId && meta?.hospitals?.length) setHospitalId(String(meta.hospitals[0].id));
  }, [meta, hospitalId]);

  const url = hospitalId
    ? `/blood-banks/availability?blood_group=${encodeURIComponent(group)}&component=${component}&hospital_id=${hospitalId}`
    : null;
  const { data, loading, error, reload } = useApi(url, [group, component, hospitalId]);

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-body">
          <div className="grid-3">
            <Field id="bg" label="Blood group needed">
              <select id="bg" value={group} onChange={(e) => setGroup(e.target.value)}>
                {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
            <Field id="bc" label="Component">
              <select id="bc" value={component} onChange={(e) => setComponent(e.target.value)}>
                {Object.entries(COMPONENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field id="bh" label="Near which hospital">
              <select id="bh" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
                {meta?.hospitals?.map((h: any) => (
                  <option key={h.id} value={h.id}>{h.name} — {h.locality}</option>
                ))}
              </select>
            </Field>
          </div>
          {data && (
            <p className="small muted mb0">
              Showing stock a {group} patient can receive: {data.compatible_groups.join(', ')}.
              Distances are straight-line from the hospital.
            </p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Stock near the hospital</h3></div>
        <div className="panel-body flush">
          {(loading || (!data && !error)) ? <TableSkeleton rows={6} cols={5} />
            : error ? <ErrorState error={error} retry={reload} />
            : data.banks.every((b: any) => b.total_units === 0)
              ? <EmptyState icon={Building2} title="No matching stock on record"
                  body={`No listed bank is holding ${COMPONENT_LABEL[component].toLowerCase()} compatible with ${group}. Widen to another component or call the banks directly.`} />
              : (
                <table>
                  <thead>
                    <tr><th>Blood bank</th><th>Locality</th><th className="num">Distance</th>
                      <th className="num">Units</th><th>Held as</th><th>Phone</th></tr>
                  </thead>
                  <tbody>
                    {data.banks.map((b: any) => (
                      <tr key={b.id} data-urgent={b.total_units === 0 ? undefined : false}>
                        <td>{b.name}</td>
                        <td className="muted">{b.locality}</td>
                        <td className="num">{b.distance_km.toFixed(1)} km</td>
                        <td className="num" style={{ fontWeight: b.total_units ? 600 : 400,
                          color: b.total_units ? undefined : 'var(--faint)' }}>{b.total_units}</td>
                        <td>
                          <span className="row wrap" style={{ gap: 4 }}>
                            {b.by_group.length === 0
                              ? <span className="faint small">none</span>
                              : b.by_group.map((s: any) => (
                                <span key={s.blood_group} className="chip chip-idle">
                                  <span className="mono">{s.blood_group}</span> {s.units}
                                </span>))}
                          </span>
                        </td>
                        <td className="mono small">{b.phone}</td>
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

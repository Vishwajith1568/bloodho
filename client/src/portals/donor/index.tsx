import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import {
  BellRing, CalendarDays, UserRound, Award, MessageSquare, Check, X, Phone,
  MapPin, Clock, CircleCheck, CircleSlash, ShieldCheck,
} from 'lucide-react';
import {
  post, patch, useApi, useStream, ApiError, COMPONENT_LABEL, fmtDate, relTime,
} from '../../lib/api';
import {
  Shell, Field, GroupChip, StatusChip, UrgencyChip, VerifyChip,
  EmptyState, ErrorState, TableSkeleton, NavItem,
} from '../../components/ui';
import { useT } from '../../lib/i18n';
import FeedbackForm from '../Feedback';

export default function DonorPortal({ lean, onLean }: any) {
  const { t } = useT();
  const { data: inbox, reload: reloadInbox } = useApi('/donor/requests');
  const pending = inbox?.matches?.filter((m: any) => m.response === 'pending').length ?? 0;
  useStream(() => reloadInbox(), ['request:broadcast', 'request:escalated']);

  const nav: NavItem[] = [
    { to: '/donor', label: t('nav.donor.requests'), icon: BellRing, badge: pending },
    { to: '/donor/profile', label: t('nav.donor.profile'), icon: UserRound },
    { to: '/donor/history', label: t('nav.donor.history'), icon: Award },
    { to: '/donor/camps', label: t('nav.donor.camps'), icon: CalendarDays },
    { to: '/donor/feedback', label: t('nav.feedback'), icon: MessageSquare },
  ];
  const F = ({ title, children }: any) => (
    <Shell portal="donor" title={title} nav={nav} lean={lean} onLean={onLean} context={t('context.donor')}>
      {children}
    </Shell>
  );

  return (
    <Routes>
      <Route path="/" element={<F title={t('nav.donor.requests')}><Inbox /></F>} />
      <Route path="profile" element={<F title={t('nav.donor.profile')}><Profile /></F>} />
      <Route path="history" element={<F title={t('nav.donor.history')}><History /></F>} />
      <Route path="camps" element={<F title={t('nav.donor.camps')}><Camps /></F>} />
      <Route path="feedback" element={<F title={t('nav.feedback')}><FeedbackForm portal="donor" /></F>} />
      <Route path="*" element={<F title={t('nav.donor.requests')}><Inbox /></F>} />
    </Routes>
  );
}

/* ============================================================ eligibility */
function EligibilityBar({ e, donor }: any) {
  const pct = e.status === 'deferred'
    ? Math.round(((e.deferralDays - e.daysRemaining) / e.deferralDays) * 100) : 100;

  const line = {
    available: 'You are eligible to donate now.',
    never_donated: 'No donation recorded yet — you are eligible whenever you are ready.',
    deferred: `${e.daysRemaining} day${e.daysRemaining === 1 ? '' : 's'} to go. Eligible again on ${fmtDate(e.nextEligibleDate)}.`,
    unavailable: donor.unavailable_reason
      ? `Paused — ${donor.unavailable_reason.toLowerCase()}.`
      : 'You have paused requests.',
  }[e.status];

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Eligibility</h3>
        <StatusChip value={e.status} label={
          e.status === 'available' ? 'Available'
            : e.status === 'deferred' ? `Deferred · ${e.daysRemaining} days`
            : e.status === 'unavailable' ? 'Unavailable' : 'Never donated'} />
      </div>
      <div className="panel-body">
        <p className="mb0">{line}</p>
        {e.status === 'deferred' && (
          <>
            <div style={{
              height: 6, background: 'var(--bone-sunk)', borderRadius: 3,
              overflow: 'hidden', margin: '14px 0 6px',
            }}>
              <div style={{ width: pct + '%', height: '100%', background: 'var(--slate)' }} />
            </div>
            <div className="row-between small muted">
              <span>Last donated {fmtDate(donor.last_donation_date)}</span>
              <span>{e.deferralDays}-day interval for whole blood</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ============================================================ inbox */
function Inbox() {
  const { data, loading, error, reload } = useApi('/donor/requests');
  const { data: me, reload: reloadMe } = useApi('/donor/profile');
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState('');
  useStream(() => reload(), ['request:broadcast', 'request:escalated']);

  async function respond(id: number, action: 'accept' | 'decline') {
    setBusy(id); setFailed('');
    try { await post(`/donor/requests/${id}/respond`, { action }); reload(); reloadMe(); }
    catch (e) { setFailed((e as ApiError).message); }
    finally { setBusy(null); }
  }

  if (loading && !data) return <div className="panel"><TableSkeleton rows={4} cols={4} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  const pending = data.matches.filter((m: any) => m.response === 'pending');
  const answered = data.matches.filter((m: any) => m.response !== 'pending');

  return (
    <div className="stack">
      {me && <EligibilityBar e={me.eligibility} donor={me.donor} />}

      {failed && <div className="banner banner-stop" role="alert"><span>{failed}</span></div>}

      {me?.eligibility?.status === 'deferred' && pending.length > 0 && (
        <div className="banner banner-warn">
          <span>You are inside your deferral window. Accept only if a doctor has cleared you.</span>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>Waiting on your answer</h3>
          {pending.length > 0 && <span className="small muted">{pending.length} request{pending.length === 1 ? '' : 's'}</span>}
        </div>
        <div className="panel-body flush">
          {pending.length === 0 ? (
            <EmptyState icon={CircleCheck} title="Nothing needs you right now"
              body="When a patient near you needs your group, the request lands here. You will see the hospital and distance before deciding." />
          ) : (
            <div>
              {pending.map((m: any) => (
                <article key={m.match_id} style={{
                  padding: 'var(--s4)', borderBottom: '1px solid var(--line)',
                  borderLeft: m.urgency === 'critical' ? '2px solid var(--crimson)' : '2px solid transparent',
                }}>
                  <div className="row-between wrap" style={{ marginBottom: 8 }}>
                    <div className="row wrap" style={{ gap: 8 }}>
                      <GroupChip group={m.blood_group} />
                      <strong>{m.units_needed} unit{m.units_needed > 1 ? 's' : ''} of {COMPONENT_LABEL[m.component]}</strong>
                      <UrgencyChip value={m.urgency} />
                      <VerifyChip state={m.verification_state} />
                    </div>
                    <span className="small muted">{relTime(m.notified_at)}</span>
                  </div>
                  <div className="row wrap small muted" style={{ gap: 'var(--s4)', marginBottom: 10 }}>
                    <span className="row" style={{ gap: 5 }}>
                      <MapPin size={13} aria-hidden />{m.hospital_name}, {m.hospital_locality}
                      {m.ward ? ` · ${m.ward}` : ''}
                    </span>
                    <span className="mono">{m.distance_km.toFixed(1)} km direct</span>
                    <span>{m.units_pledged} of {m.units_needed} pledged so far</span>
                  </div>
                  {m.notes && <p className="small" style={{ marginBottom: 10 }}>{m.notes}</p>}
                  <div className="row wrap">
                    <button className="btn btn-primary btn-sm" disabled={busy === m.match_id}
                      onClick={() => respond(m.match_id, 'accept')}>
                      <Check size={14} aria-hidden /> Accept
                    </button>
                    <button className="btn btn-sm" disabled={busy === m.match_id}
                      onClick={() => respond(m.match_id, 'decline')}>
                      <X size={14} aria-hidden /> Cannot go
                    </button>
                    <span className="small faint">
                      The attendant's number is shown to you only after you accept.
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Already answered</h3></div>
        <div className="panel-body flush">
          {answered.length === 0
            ? <EmptyState title="No past requests" body="Requests you accept or decline are listed here." />
            : (
              <table>
                <thead>
                  <tr><th>Reference</th><th>Group</th><th>Hospital</th><th className="num">Distance</th>
                    <th>Your answer</th><th>Attendant</th></tr>
                </thead>
                <tbody>
                  {answered.map((m: any) => (
                    <tr key={m.match_id}>
                      <td className="mono small">{m.ref_code}</td>
                      <td><GroupChip group={m.blood_group} /></td>
                      <td className="muted">{m.hospital_name}</td>
                      <td className="num">{m.distance_km.toFixed(1)} km</td>
                      <td><StatusChip value={m.response} /></td>
                      <td className={m.response === 'accepted' ? 'mono small' : 'faint small'}>
                        {m.response === 'accepted'
                          ? <span className="row" style={{ gap: 5 }}>
                              <Phone size={13} aria-hidden />{m.attendant_name} · {m.attendant_phone}</span>
                          : 'Hidden'}
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

/* ============================================================ profile */
function Profile() {
  const { data, loading, error, reload, setData } = useApi('/donor/profile');
  const [form, setForm] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <div className="panel"><TableSkeleton rows={4} cols={2} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  const d = form ?? {
    locality: data.donor.locality, phone: data.donor.phone,
    contact_pref: data.donor.contact_pref, quiet_hours: !!data.donor.quiet_hours,
  };
  const set = (k: string, v: any) => { setForm({ ...d, [k]: v }); setSaved(false); };

  async function save(e: any) {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      const r = await patch('/donor/profile', d);
      setData(r); setForm(null); setSaved(true);
    } catch (err) { setErrors((err as ApiError).errors ?? {}); }
    finally { setBusy(false); }
  }

  async function toggleAvailability(available: boolean, reason?: string) {
    const r = await post('/donor/availability', {
      is_available: available, reason: reason ?? null,
    });
    setData(r);
  }

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <EligibilityBar e={data.eligibility} donor={data.donor} />

      <section className="panel">
        <div className="panel-head">
          <h3>Registration</h3>
          <VerifyChip state={data.donor.verification_state} />
        </div>
        <div className="panel-body">
          <dl className="grid-2" style={{ margin: 0 }}>
            <div><dt className="small muted">Name</dt><dd style={{ margin: 0 }}>{data.donor.full_name}</dd></div>
            <div><dt className="small muted">Blood group</dt>
              <dd style={{ margin: 0 }}><GroupChip group={data.donor.blood_group} /></dd></div>
            <div><dt className="small muted">Last donation</dt>
              <dd style={{ margin: 0 }}>{fmtDate(data.donor.last_donation_date)}</dd></div>
            <div><dt className="small muted">Lifetime donations</dt>
              <dd style={{ margin: 0 }} className="mono">{data.donor.total_donations}</dd></div>
          </dl>
          <p className="small muted mt4 mb0">
            Blood group and name are fixed after verification. Contact the blood bank to correct them.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Availability</h3></div>
        <div className="panel-body">
          {data.donor.is_available ? (
            <div className="row-between wrap">
              <span>You are receiving emergency requests.</span>
              <button className="btn btn-sm btn-danger"
                onClick={() => toggleAvailability(false, 'Paused from the app')}>
                <CircleSlash size={14} aria-hidden /> Pause requests
              </button>
            </div>
          ) : (
            <div className="row-between wrap">
              <span className="row" style={{ gap: 8 }}>
                <Clock size={15} aria-hidden className="muted" />
                Paused{data.donor.unavailable_reason ? ` — ${data.donor.unavailable_reason.toLowerCase()}` : ''}
                {data.donor.unavailable_until ? ` until ${fmtDate(data.donor.unavailable_until)}` : ''}.
              </span>
              <button className="btn btn-sm btn-primary" onClick={() => toggleAvailability(true)}>
                <CircleCheck size={14} aria-hidden /> Start receiving again
              </button>
            </div>
          )}
        </div>
      </section>

      <form className="panel" onSubmit={save} noValidate>
        <div className="panel-head"><h3>Contact details</h3></div>
        <div className="panel-body">
          {saved && <div className="banner banner-ok" style={{ marginBottom: 16 }}><span>Contact details saved.</span></div>}
          <div className="grid-2">
            <Field id="phone" label="Mobile number" error={errors.phone}>
              <input id="phone" className="num-input" inputMode="numeric" maxLength={10}
                value={d.phone} aria-invalid={!!errors.phone}
                onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field id="loc" label="Locality" hint="Used to measure distance to a hospital">
              <input id="loc" value={d.locality} onChange={(e) => set('locality', e.target.value)} />
            </Field>
          </div>
          <fieldset style={{ marginBottom: 16 }}>
            <legend>How should an attendant reach you after you accept?</legend>
            <div className="segmented">
              {[['call', 'Phone call'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['in_app', 'In the app']].map(([v, l]) => (
                <label key={v}>
                  <input type="radio" name="cp" checked={d.contact_pref === v}
                    onChange={() => set('contact_pref', v)} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={d.quiet_hours} style={{ width: 'auto' }}
              onChange={(e) => set('quiet_hours', e.target.checked)} />
            <span>Hold non-critical requests between 10 pm and 6 am</span>
          </label>
          <div className="mt4">
            <button className="btn btn-primary" disabled={busy || !form}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ============================================================ history */
function History() {
  const { data, loading, error, reload } = useApi('/donor/history');
  if (loading && !data) return <div className="panel"><TableSkeleton rows={5} cols={4} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  const earned = new Set(data.badges.map((b: any) => b.code));

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h3>Donations</h3>
          <span className="small muted mono">{data.donations.length} recorded</span>
        </div>
        <div className="panel-body flush">
          {data.donations.length === 0
            ? <EmptyState icon={Award} title="No donations recorded yet"
                body="Once you donate at a camp or a blood bank, each donation and its certificate number appears here." />
            : (
              <table>
                <thead>
                  <tr><th>Date</th><th>Component</th><th className="num">Units</th>
                    <th>Type</th><th>Collected at</th><th>Certificate</th></tr>
                </thead>
                <tbody>
                  {data.donations.map((x: any) => (
                    <tr key={x.id}>
                      <td>{fmtDate(x.donated_on)}</td>
                      <td>{COMPONENT_LABEL[x.component]}</td>
                      <td className="num">{x.units}</td>
                      <td><StatusChip value={x.donation_type === 'voluntary' ? 'available' : 'scheduled'}
                        label={x.donation_type === 'voluntary' ? 'Voluntary' : 'Replacement'} /></td>
                      <td className="muted">{x.bank_name ?? '—'}</td>
                      <td className="mono small">{x.certificate_no ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Milestones</h3>
          <span className="small muted">{data.badges.length} of {data.allBadges.length} earned</span></div>
        <div className="panel-body flush">
          <table>
            <thead><tr><th>Milestone</th><th>What it recognises</th><th>Earned</th></tr></thead>
            <tbody>
              {data.allBadges.map((b: any) => {
                const got = data.badges.find((x: any) => x.code === b.code);
                return (
                  <tr key={b.code} style={{ opacity: earned.has(b.code) ? 1 : 0.55 }}>
                    <td>
                      <span className="row" style={{ gap: 7 }}>
                        {earned.has(b.code)
                          ? <CircleCheck size={14} aria-hidden style={{ color: 'var(--ok)' }} />
                          : <CircleSlash size={14} aria-hidden className="faint" />}
                        <strong style={{ fontWeight: earned.has(b.code) ? 600 : 400 }}>{b.label}</strong>
                      </span>
                    </td>
                    <td className="muted small">{b.descriptor}</td>
                    <td className="small">{got ? fmtDate(got.earned_on) : <span className="faint">Not yet</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ============================================================ camps */
function Camps() {
  const { data, loading, error, reload } = useApi('/donor/camps');
  const [busy, setBusy] = useState<number | null>(null);

  async function toggle(camp: any) {
    setBusy(camp.id);
    try {
      if (camp.my_status === 'registered') await fetch(`/api/donor/camps/${camp.id}/register`, { method: 'DELETE' });
      else await post(`/donor/camps/${camp.id}/register`, { slot_time: camp.start_time });
      reload();
    } finally { setBusy(null); }
  }

  if (loading && !data) return <div className="panel"><TableSkeleton rows={3} cols={5} /></div>;
  if (error) return <ErrorState error={error} retry={reload} />;

  return (
    <section className="panel">
      <div className="panel-head"><h3>Upcoming camps in the city</h3></div>
      <div className="panel-body flush">
        {data.camps.length === 0
          ? <EmptyState icon={CalendarDays} title="No camps scheduled"
              body="City control publishes camps here as they are arranged." />
          : (
            <table>
              <thead>
                <tr><th>Camp</th><th>Venue</th><th>Date</th><th>Timing</th>
                  <th className="num">Registered</th><th>Your slot</th><th></th></tr>
              </thead>
              <tbody>
                {data.camps.map((c: any) => (
                  <tr key={c.id}>
                    <td><strong style={{ fontWeight: 500 }}>{c.title}</strong>
                      <div className="small muted">{c.organiser}</div></td>
                    <td className="muted">{c.venue}<div className="small">{c.locality}</div></td>
                    <td>{fmtDate(c.camp_date)}</td>
                    <td className="mono small">{c.start_time}–{c.end_time}</td>
                    <td className="num">{c.registered}/{c.capacity}</td>
                    <td>{c.my_status === 'registered'
                      ? <span className="chip chip-ok">{c.my_slot}</span>
                      : <span className="faint small">—</span>}</td>
                    <td>
                      <button className={'btn btn-sm' + (c.my_status === 'registered' ? '' : ' btn-primary')}
                        disabled={busy === c.id || (c.my_status !== 'registered' && c.registered >= c.capacity)}
                        onClick={() => toggle(c)}>
                        {c.my_status === 'registered' ? 'Cancel'
                          : c.registered >= c.capacity ? 'Full' : 'Register'}
                      </button>
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

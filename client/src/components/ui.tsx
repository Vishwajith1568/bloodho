import { NavLink } from 'react-router-dom';
import { AlertCircle, Droplet, Inbox, LogOut, SignalLow, WifiOff, Languages } from 'lucide-react';
import { useSession } from '../lib/api';
import { useT, LANGUAGES, Lang } from '../lib/i18n';

/* ------------------------------------------------------------ chips */
export function GroupChip({ group }: { group: string }) {
  return <span className={'chip chip-group' + (group.endsWith('-') ? ' neg' : '')}>{group}</span>;
}

const STATUS_TONE: Record<string, string> = {
  available: 'ok', fulfilled: 'ok', accepted: 'ok', approved: 'ok', verified: 'ok', completed: 'ok',
  deferred: 'warn', pending: 'warn', partially_fulfilled: 'warn', reserved: 'warn', broadcasting: 'warn',
  unavailable: 'stop', rejected: 'stop', declined: 'stop', cancelled: 'stop', expired: 'stop',
  critical: 'stop', unverified: 'stop', discarded: 'stop',
  urgent: 'warn', scheduled: 'info', otp_verified: 'info', hospital_verified: 'ok',
  draft: 'idle', never_donated: 'idle', issued: 'idle',
};

export function StatusChip({ value, label }: { value: string; label?: string }) {
  const { t } = useT();
  const tone = STATUS_TONE[value] ?? 'idle';
  // An explicit label wins; otherwise look the status up in the active language.
  const text = label ?? t(`status.${value}`, value.replace(/_/g, ' '));
  return <span className={`chip chip-${tone}`}>{text.charAt(0).toUpperCase() + text.slice(1)}</span>;
}

export function VerifyChip({ state }: { state: string }) {
  const { t } = useT();
  return <StatusChip value={state} label={t(`verify.${state}`, state)} />;
}

export function UrgencyChip({ value }: { value: string }) {
  const { t } = useT();
  return <StatusChip value={value} label={t(`urgency.${value}`, value)} />;
}

/* ------------------------------------------------------------ states */
export function EmptyState({ title, body, action, icon }: {
  title: string; body: string; action?: any; icon?: any;
}) {
  const Icon = icon ?? Inbox;
  return (
    <div className="state">
      <Icon size={20} className="state-icon" aria-hidden />
      <h4>{title}</h4>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: any; retry?: () => void }) {
  return (
    <div className="state">
      <AlertCircle size={20} className="state-icon" aria-hidden />
      <h4>{error?.status === 403 ? 'You cannot open this' : 'This did not load'}</h4>
      <p>{error?.message ?? 'The server did not respond. Check that it is running on port 4000.'}</p>
      {retry && <button className="btn btn-sm" onClick={retry}>Try again</button>}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <table aria-busy="true">
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c}><div className="skel" style={{ width: `${45 + ((r + c) % 4) * 15}%` }} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------ form field */
export function Field({ label, error, hint, children, id }: {
  label: string; error?: string; hint?: string; children: any; id: string;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      {children}
      {error && (
        <span className="err" role="alert">
          <AlertCircle size={13} aria-hidden /> {error}
        </span>
      )}
      {!error && hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ shell */
export type NavItem = { to: string; label: string; icon: any; badge?: number | string };

export function Shell({ portal, title, context, nav, children, lean, onLean }: {
  portal: 'donor' | 'requester' | 'bank' | 'admin';
  title: string;
  context?: any;
  nav: NavItem[];
  children: any;
  lean: boolean;
  onLean: (v: boolean) => void;
}) {
  const { account, signOut } = useSession();
  const { t, lang, setLang } = useT();
  const portalName = t(`portal.${portal}`);

  return (
    <div className="shell" data-portal={portal}>
      <aside className="sidebar">
        <div className="brand">
          <Droplet className="mark" size={15} strokeWidth={2} aria-hidden />
          <div>
            <div className="brand-name">{t('app.name')}</div>
            <div className="brand-portal">{portalName}</div>
          </div>
        </div>
        <nav className="nav" aria-label={portalName + ' sections'}>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to.split('/').length <= 2}
              className={({ isActive }) => (isActive ? 'active' : '')}>
              <n.icon size={15} strokeWidth={1.75} aria-hidden />
              <span>{n.label}</span>
              {n.badge != null && n.badge !== 0 && <span className="badge">{n.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="row-between">
            <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {account?.full_name}
            </span>
            <button className="btn btn-sm btn-ghost" onClick={signOut} title={t('app.signOut')}>
              <LogOut size={14} aria-hidden /><span className="sr-only">{t('app.signOut')}</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <h1>{title}</h1>
          {context && <><span className="sep" aria-hidden /><span className="context hide-sm">{context}</span></>}
          <span className="spacer" />
          <label className="row" style={{ gap: 6 }}>
            <Languages size={14} aria-hidden className="muted" />
            <span className="sr-only">{t('app.language')}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}
              style={{ width: 'auto', padding: '4px 8px', fontSize: 'var(--t-small)' }}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.native}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-sm btn-ghost" onClick={() => onLean(!lean)}
            aria-pressed={lean}
            title={lean ? t('app.lowBandwidthOffHint') : t('app.lowBandwidthHint')}>
            {lean ? <WifiOff size={14} aria-hidden /> : <SignalLow size={14} aria-hidden />}
            <span>{lean ? t('app.lowBandwidthOn') : t('app.lowBandwidth')}</span>
          </button>
        </div>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

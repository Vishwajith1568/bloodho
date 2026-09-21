import { createContext, useContext, useEffect, useState, useCallback } from 'react';

/* ------------------------------------------------------------ fetch */
export class ApiError extends Error {
  status: number;
  code: string;
  errors: Record<string, string>;
  constructor(status: number, body: any) {
    super(body?.message ?? 'Something went wrong.');
    this.status = status;
    this.code = body?.error ?? 'unknown';
    this.errors = body?.errors ?? {};
  }
}

let leanMode = false;
export function setLean(v: boolean) { leanMode = v; }

export async function api(path: string, init: RequestInit = {}) {
  const url = '/api' + path + (leanMode ? (path.includes('?') ? '&lean=1' : '?lean=1') : '');
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

export const post = (p: string, data?: unknown) =>
  api(p, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });
export const patch = (p: string, data: unknown) =>
  api(p, { method: 'PATCH', body: JSON.stringify(data) });

/* ------------------------------------------------------------ session */
type Account = {
  id: number; email: string; full_name: string;
  role: 'donor' | 'requester' | 'bank' | 'admin';
  donor_id: number | null; bank_id: number | null; hospital_id: number | null;
};

const SessionCtx = createContext<{
  account: Account | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<Account>;
  signOut: () => Promise<void>;
}>(null as any);

export function SessionProvider({ children }: { children: any }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/auth/me')
      .then((r) => setAccount(r.account))
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await post('/auth/login', { email, password });
    setAccount(r.account);
    return r.account;
  }, []);

  const signOut = useCallback(async () => {
    await post('/auth/logout').catch(() => {});
    setAccount(null);
  }, []);

  return (
    <SessionCtx.Provider value={{ account, loading, signIn, signOut }}>
      {children}
    </SessionCtx.Provider>
  );
}

export const useSession = () => useContext(SessionCtx);

/* ------------------------------------------------------------ data hook */
export function useApi<T = any>(path: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);

  const reload = useCallback(() => {
    if (!path) return;
    // Only show the loading state on a first load. Background refreshes
    // (polling, live events) must not flash a populated panel back to a
    // skeleton — the data on screen stays until the new data replaces it.
    setData((prev) => { if (prev == null) setLoading(true); return prev; });
    api(path)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(reload, [path, ...deps]);
  return { data, error, loading, reload, setData };
}

/* ------------------------------------------------------------ live stream */
export function useStream(handler: (topic: string, payload: any) => void, topics: string[]) {
  useEffect(() => {
    const es = new EventSource('/api/stream');
    const listeners = topics.map((t) => {
      const fn = (e: MessageEvent) => handler(t, JSON.parse(e.data));
      es.addEventListener(t, fn as any);
      return [t, fn] as const;
    });
    return () => { listeners.forEach(([t, fn]) => es.removeEventListener(t, fn as any)); es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics.join(',')]);
}

/* ------------------------------------------------------------ labels */
export const COMPONENT_LABEL: Record<string, string> = {
  whole_blood: 'Whole blood',
  prbc: 'Packed red cells',
  platelets: 'Platelets',
  plasma: 'Plasma',
};

export const URGENCY_LABEL: Record<string, string> = {
  critical: 'Critical',
  urgent: 'Urgent',
  scheduled: 'Scheduled',
};

export const VERIFY_LABEL: Record<string, string> = {
  unverified: 'Unverified',
  otp_verified: 'OTP verified',
  hospital_verified: 'Hospital verified',
  rejected: 'Verification rejected',
};

export function fmtDate(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d.length <= 10 ? d + 'T00:00:00' : d.replace(' ', 'T') + 'Z');
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtTime(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d.replace(' ', 'T') + 'Z');
  return dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function relTime(d: string | null) {
  if (!d) return '—';
  const then = new Date(d.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

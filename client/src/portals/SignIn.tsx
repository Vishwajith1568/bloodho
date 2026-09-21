import { useState } from 'react';
import { Droplet } from 'lucide-react';
import { useSession, ApiError } from '../lib/api';
import { Field } from '../components/ui';

const DEMO = [
  ['Donor', 'sridhar.1@donor.test', 'donor@123'],
  ['Requester', 'kavitha.r@family.test', 'care@123'],
  ['Blood bank', 'ntrtrust@bank.test', 'bank@123'],
  ['City control', 'control@bloodfinder.test', 'admin@123'],
];

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: any) {
    e.preventDefault();
    setErrors({}); setFailure('');
    const next: Record<string, string> = {};
    if (!email.trim()) next.email = 'Enter your registered email.';
    if (!password) next.password = 'Enter your password.';
    if (Object.keys(next).length) return setErrors(next);

    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.code === 'validation') setErrors(e2.errors);
      else setFailure(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <aside className="signin-aside">
        <div className="row" style={{ gap: 8 }}>
          <Droplet size={18} strokeWidth={2} style={{ color: '#D96A6A' }} aria-hidden />
          <strong style={{ color: '#FCF9F6' }}>Blood Finder</strong>
        </div>
        <h2>Emergency blood matching for Hyderabad</h2>
        <p className="lede">
          Four portals share one register of donors, blood banks and requests: donors respond to
          matched requests, families raise and track them, banks manage stock, and city control
          watches fulfilment across all of it.
        </p>
        <div>
          <p className="lede" style={{ marginBottom: 10 }}>Accounts loaded with the sample register:</p>
          <dl>
            {DEMO.map(([role, mail, pw]) => (
              <div key={mail} style={{ display: 'contents' }}>
                <dt>{role}</dt>
                <dd>
                  <button type="button"
                    style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                    onClick={() => { setEmail(mail); setPassword(pw); }}>
                    {mail}
                  </button>
                  <div style={{ color: '#8D857C' }}>{pw}</div>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>

      <div className="signin-main">
        <form className="signin-form" onSubmit={submit} noValidate>
          <h1 style={{ marginBottom: 6 }}>Sign in</h1>
          <p className="muted">Your account decides which portal opens.</p>

          {failure && (
            <div className="banner banner-stop mt4" role="alert" style={{ marginBottom: 16 }}>
              <span>{failure}</span>
            </div>
          )}

          <Field id="email" label="Email" error={errors.email}>
            <input id="email" type="email" value={email} autoComplete="username"
              aria-invalid={!!errors.email}
              onChange={(e) => setEmail(e.target.value)} />
          </Field>

          <Field id="password" label="Password" error={errors.password}>
            <input id="password" type="password" value={password} autoComplete="current-password"
              aria-invalid={!!errors.password}
              onChange={(e) => setPassword(e.target.value)} />
          </Field>

          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
            disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

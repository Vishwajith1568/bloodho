import { useState } from 'react';
import { post, ApiError } from '../lib/api';
import { Field } from '../components/ui';

const CATEGORIES = [
  'matching', 'notifications', 'verification', 'inventory',
  'transfers', 'profile', 'something else',
];

export default function FeedbackForm({ portal }: { portal: string }) {
  const [category, setCategory] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: any) {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      await post('/feedback', { category, rating, message });
      setSent(true); setMessage(''); setCategory(''); setRating(null);
    } catch (err) { setErrors((err as ApiError).errors ?? {}); }
    finally { setBusy(false); }
  }

  return (
    <form className="panel" onSubmit={submit} noValidate style={{ maxWidth: 620 }}>
      <div className="panel-head"><h3>Tell city control what is not working</h3></div>
      <div className="panel-body">
        {sent && (
          <div className="banner banner-ok" style={{ marginBottom: 16 }} role="status">
            <span>Sent. It is in the city control inbox, tagged as coming from the {portal} portal.</span>
          </div>
        )}
        <Field id="fcat" label="What is this about?" error={errors.category}>
          <select id="fcat" value={category} aria-invalid={!!errors.category}
            onChange={(e) => { setCategory(e.target.value); setSent(false); }}>
            <option value="">Choose a topic</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </Field>

        <fieldset style={{ marginBottom: 16 }}>
          <legend>How well did it work? (optional)</legend>
          <div className="segmented">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n}>
                <input type="radio" name="rating" checked={rating === n} onChange={() => setRating(n)} />
                <span className="mono">{n}</span>
              </label>
            ))}
          </div>
          {errors.rating && <span className="err">{errors.rating}</span>}
        </fieldset>

        <Field id="fmsg" label="What happened?" error={errors.message}
          hint="Be specific — which screen, what you expected, what you got.">
          <textarea id="fmsg" rows={4} value={message} aria-invalid={!!errors.message}
            onChange={(e) => { setMessage(e.target.value); setSent(false); }} />
        </Field>

        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send feedback'}
        </button>
      </div>
    </form>
  );
}

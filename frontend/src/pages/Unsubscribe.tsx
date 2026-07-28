import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';

type Status = 'working' | 'unsubscribed' | 'already' | 'unknown' | 'error';

/**
 * Landing page for the brief's unsubscribe link (GOI-35).
 *
 * No sign-in: the token in the URL is the credential. The backend's GET route
 * also redirects here with `?status=` once it has already done the work, so
 * this page renders both the "we did it" and the "do it now" cases.
 */
export function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const redirected = params.get('status');

  const [status, setStatus] = useState<Status>(() => {
    if (redirected === 'unsubscribed' || redirected === 'already' || redirected === 'unknown') {
      return redirected;
    }
    return token ? 'working' : 'unknown';
  });
  const [email, setEmail] = useState<string | null>(null);

  const unsubscribe = trpc.my.newsletter.unsubscribe.useMutation();
  // StrictMode double-mounts in dev; without this the mutation fires twice.
  const fired = useRef(false);

  useEffect(() => {
    if (!token || redirected || fired.current) return;
    fired.current = true;
    unsubscribe.mutate(
      { token },
      {
        onSuccess: (res) => {
          setStatus(res.status);
          setEmail('email' in res ? res.email : null);
        },
        onError: () => setStatus('error'),
      },
    );
  }, [token, redirected, unsubscribe]);

  return (
    <section className="max-w-prose">
      <h1 className="font-serif text-4xl tracking-tight">Newsletter</h1>
      <div className="mt-6 text-muted">{body(status, email)}</div>

      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
        <Link to="/" className="tag text-muted hover:text-ink transition-colors">
          Back to what&rsquo;s on
        </Link>
        {status === 'unsubscribed' || status === 'already' ? (
          <Link to="/my?tab=newsletter" className="tag text-accent">
            Turn it back on
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function body(status: Status, email: string | null) {
  const who = email ? <strong className="text-ink">{email}</strong> : 'this address';
  switch (status) {
    case 'working':
      return <p>Unsubscribing&hellip;</p>;
    case 'unsubscribed':
      return (
        <p>
          Done — no more briefs to {who}. Nothing else about your account changed, and your
          saved venues are untouched.
        </p>
      );
    case 'already':
      return <p>The brief was already off for {who}. Nothing to do.</p>;
    case 'unknown':
      return (
        <p>
          That unsubscribe link isn&rsquo;t valid — it may have been truncated by your email
          client. You can switch the brief off directly in{' '}
          <Link to="/my?tab=newsletter" className="underline">
            your newsletter settings
          </Link>
          .
        </p>
      );
    case 'error':
      return (
        <p>
          Something went wrong reaching Goin. Try the link again in a minute, or switch the
          brief off in{' '}
          <Link to="/my?tab=newsletter" className="underline">
            your newsletter settings
          </Link>
          .
        </p>
      );
  }
}

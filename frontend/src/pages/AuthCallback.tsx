import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { setSessionToken } from '../lib/auth';

/** Landing page for magic-link emails: /auth?token=… Verifies the token,
 *  stores the session and moves on to /my. */
export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const fired = useRef(false);

  const verify = trpc.auth.verify.useMutation({
    onSuccess: async (res) => {
      setSessionToken(res.sessionToken);
      await utils.invalidate();
      navigate('/my', { replace: true });
    },
    onError: (e) => setError(e.message),
  });

  const token = params.get('token');

  useEffect(() => {
    // StrictMode double-mount guard: a magic link is single-use, so the second
    // mount must not consume (and thereby invalidate) the token again.
    if (fired.current) return;
    fired.current = true;
    if (token) verify.mutate({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) {
    return <p className="text-muted">Missing login token — use the link from your email.</p>;
  }
  if (error) {
    return (
      <div>
        <p className="text-muted">{error}</p>
        <p className="mt-2 text-sm text-muted">
          Login links are single-use and expire after 15 minutes. Request a new one from the /my page.
        </p>
      </div>
    );
  }
  return <p className="text-muted">Logging you in…</p>;
}

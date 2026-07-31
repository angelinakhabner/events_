import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { setSessionToken } from '../lib/auth';

/**
 * Login landing page. Two shapes:
 *   /auth?token=…        magic-link email — verifies the single-use token;
 *   /auth#session=…      OAuth (Google) — the backend already minted the
 *                        session and passed it in the fragment (fragments
 *                        never reach servers or logs); #error=… on failure.
 * Both store the session and move on to /my.
 */
export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const location = useLocation();
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
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const oauthSession = hash.get('session');
  const oauthError = hash.get('error');

  useEffect(() => {
    // StrictMode double-mount guard: a magic link is single-use, so the second
    // mount must not consume (and thereby invalidate) the token again.
    if (fired.current) return;
    fired.current = true;
    if (oauthSession) {
      setSessionToken(oauthSession);
      void utils.invalidate().then(() => navigate('/my', { replace: true }));
      return;
    }
    if (oauthError) {
      setError(oauthError);
      return;
    }
    if (token) verify.mutate({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token && !oauthSession && !oauthError) {
    return <p className="page-x pt-12 text-muted">Missing login token — use the link from your email.</p>;
  }
  if (error) {
    return (
      <div className="page-x pt-12">
        <p className="font-display text-2xl text-accent">{error}</p>
        <p className="mt-2 text-sm text-muted">
          {oauthError
            ? 'You can try again from the /my page.'
            : 'Login links are single-use and expire after 15 minutes. Request a new one from the /my page.'}
        </p>
      </div>
    );
  }
  return <p className="page-x pt-12 text-muted">Logging you in…</p>;
}

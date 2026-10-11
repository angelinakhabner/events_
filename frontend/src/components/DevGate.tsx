import { useLayoutEffect, useState, type FormEvent, type ReactNode } from 'react';
import { hideLanding } from '../lib/landing';

// Access gate for the dev preview deployment. The dev build bakes in
// VITE_DEV_GATE_HASH (a SHA-256 hex digest of the dev password); production
// and local builds leave it unset, so the gate renders nothing there.
//
// This is a lightweight deterrent for a public static preview, not real
// security — the bundle itself is publicly downloadable.

const STORAGE_KEY = 'afisz-dev-gate';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function DevGate({ children }: { children: ReactNode }) {
  const gateHash = import.meta.env.VITE_DEV_GATE_HASH;
  const [unlocked, setUnlocked] = useState(
    () => !gateHash || localStorage.getItem(STORAGE_KEY) === gateHash,
  );
  const [error, setError] = useState(false);

  // The public landing page ships in index.html and is visible from the first
  // paint (src/landing/render.ts). On the dev preview the password form is
  // what should be on screen instead, so draw the curtain before painting —
  // the landing page's stylesheet keeps `#root` collapsed until it is hidden,
  // which would otherwise leave the form invisible underneath it.
  useLayoutEffect(() => {
    if (!unlocked) hideLanding();
  }, [unlocked]);

  if (unlocked) return <>{children}</>;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = new FormData(e.currentTarget).get('password');
    const hash = await sha256Hex(String(input ?? ''));
    if (hash === gateHash) {
      localStorage.setItem(STORAGE_KEY, hash);
      setUnlocked(true);
    } else {
      setError(true);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center px-5">
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4 text-center">
        <p className="font-display text-3xl uppercase">AFISZ — dev preview</p>
        <input
          type="password"
          name="password"
          aria-label="Dev access password"
          placeholder="Dev access password"
          autoFocus
          className="field"
        />
        <button type="submit" className="btn-fill w-full">
          Enter
        </button>
        {error && (
          <p role="alert" className="text-sm font-bold text-accent">
            Wrong password.
          </p>
        )}
      </form>
    </div>
  );
}

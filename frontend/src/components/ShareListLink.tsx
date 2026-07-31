import { useEffect, useState } from 'react';
import { trpc } from '../lib/trpc';
import { shareLink, sharedListUrl, type ShareOutcome } from '../lib/share';

/**
 * "Share this list" (GOI-47) — mints a read-only public link to the owner's
 * "want to go" list, and takes it back again.
 *
 * The link is the whole credential: anyone holding it can read the list, and
 * revoking is the only way to withdraw it. The copy says so, because a link
 * that looks private and isn't is the failure mode worth spending a sentence
 * on. Sharing again after revoking mints a *different* link, so the old one
 * stays dead.
 */
export function ShareListLink() {
  const utils = trpc.useUtils();
  const share = trpc.my.wantToGo.share.get.useQuery();
  const invalidate = () => utils.my.wantToGo.share.get.invalidate();
  const enable = trpc.my.wantToGo.share.enable.useMutation({ onSuccess: invalidate });
  const disable = trpc.my.wantToGo.share.disable.useMutation({ onSuccess: invalidate });

  const token = share.data?.token ?? null;
  const busy = enable.isPending || disable.isPending;

  if (share.isLoading) return null;

  if (!token) {
    return (
      <div className="mb-6">
        <button
          type="button"
          onClick={() => enable.mutate()}
          disabled={busy}
          className="text-sm link-accent bg-transparent border border-rule px-4 py-2 cursor-pointer disabled:opacity-50"
        >
          {enable.isPending ? 'Creating link…' : 'Share this list'}
        </button>
        {enable.error ? <p className="mt-2 text-sm text-muted">{enable.error.message}</p> : null}
      </div>
    );
  }

  return (
    <div className="mb-6 border border-rule p-3">
      <p className="text-xs uppercase tracking-widest text-muted">Shared link</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <code className="text-sm text-ink break-all">{sharedListUrl(token)}</code>
        <CopyLinkButton url={sharedListUrl(token)} />
        <button
          type="button"
          onClick={() => disable.mutate()}
          disabled={busy}
          className="text-sm text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50"
        >
          {disable.isPending ? 'Stopping…' : 'Stop sharing'}
        </button>
      </div>
      <p className="mt-2 text-sm text-muted max-w-prose">
        Anyone with this link can see what you want to go to — no account needed. Things
        you&rsquo;ve marked seen stay private. Stop sharing to kill the link; sharing again
        creates a new one.
      </p>
    </div>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);

  // Auto-clear the small toast after a beat so it doesn't pile up.
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(() => setOutcome(null), 1800);
    return () => clearTimeout(t);
  }, [outcome]);

  const flash =
    outcome === 'copied' ? 'Link copied' :
    outcome === 'shared' ? 'Shared' :
    outcome === 'failed' ? "Couldn't copy" :
    null;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={async () => {
          const result = await shareLink({ title: 'Want to go', text: 'My “want to go” list', url });
          if (result !== 'cancelled') setOutcome(result);
        }}
        className="text-sm text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
      >
        Copy
      </button>
      {flash ? (
        <span role="status" aria-live="polite" className="text-xs text-muted">
          {flash}
        </span>
      ) : null}
    </span>
  );
}

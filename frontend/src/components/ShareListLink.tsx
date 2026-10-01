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
          className="btn-outline"
        >
          {enable.isPending ? 'Tworzenie linku…' : 'Udostępnij tę listę'}
        </button>
        {enable.error ? <p className="mt-2 text-sm text-accent">{enable.error.message}</p> : null}
      </div>
    );
  }

  return (
    <div className="mb-6 border-3 border-ink bg-panel p-4">
      <p className="label-caps">Udostępniony link</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <code className="text-sm text-ink break-all">{sharedListUrl(token)}</code>
        <CopyLinkButton url={sharedListUrl(token)} />
        <button
          type="button"
          onClick={() => disable.mutate()}
          disabled={busy}
          className="act act-sm"
        >
          {disable.isPending ? 'Wyłączanie…' : 'Przestań udostępniać'}
        </button>
      </div>
      <p className="mt-3 text-sm text-body max-w-[520px]">
        Każdy, kto ma ten link, zobaczy, na co chcesz iść — bez zakładania konta. To, co
        oznaczysz jako obejrzane, pozostaje prywatne. Wyłączenie udostępniania unieważnia link;
        ponowne udostępnienie tworzy nowy.
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
    outcome === 'copied' ? 'Skopiowano link' :
    outcome === 'shared' ? 'Udostępniono' :
    outcome === 'failed' ? 'Nie udało się skopiować' :
    null;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={async () => {
          const result = await shareLink({ title: 'Chcę iść', text: 'Moja lista „Chcę iść”', url });
          if (result !== 'cancelled') setOutcome(result);
        }}
        className="act act-sm"
      >
        Kopiuj
      </button>
      {flash ? (
        <span role="status" aria-live="polite" className="text-[11px] text-faint">
          {flash}
        </span>
      ) : null}
    </span>
  );
}

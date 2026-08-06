import { useEffect, useState } from 'react';
import { DEFAULT_SHARE_TEMPLATE, SHARE_TEMPLATE_TOKENS } from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { inviteText } from '../lib/share';
import { ErrorState } from './states';

/**
 * /my → Settings (GOI-49): the wording the share button sends.
 *
 * Sharing is the one place the app puts words in the reader's mouth — they get
 * pasted into someone else's chat under the reader's name — so the default is
 * only a default. "Darling" is charming to a partner and odd to a colleague,
 * and that isn't a call the app can make for anyone.
 *
 * The preview is the point of the screen: placeholders are only obvious once
 * you watch one fill in, so it renders the live template against a fixed
 * example event as you type.
 */

/** A stand-in event for the preview. Fixed on purpose — the reader is judging
 *  their wording, not looking up a real showtime. */
const PREVIEW_EVENT = {
  title: 'Perfect Days',
  venue: { name: 'Kino Muranów' },
  category: 'cinema' as const,
  startsAt: '2026-07-04T18:00:00.000Z',
  sourceUrl: 'https://example.com',
};

export function SettingsSection() {
  const utils = trpc.useUtils();
  const settings = trpc.my.settings.get.useQuery();
  const [shareText, setShareText] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const save = trpc.my.settings.save.useMutation({
    onSuccess: async (saved) => {
      setShareText(saved.shareText);
      setJustSaved(true);
      await utils.my.settings.get.invalidate();
    },
  });

  // Clear the confirmation after a beat so it doesn't sit there for the session.
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(t);
  }, [justSaved]);

  // `null` means "not edited yet", so the field takes the saved value as soon
  // as it arrives without clobbering anything already typed.
  const value = shareText ?? settings.data?.shareText ?? DEFAULT_SHARE_TEMPLATE;
  const isDefault = value.trim() === DEFAULT_SHARE_TEMPLATE;

  return (
    <section>
      <h2 className="font-display text-[26px] md:text-[32px] m-0">Settings</h2>
      <p className="mt-1.5 mb-6 max-w-[520px] text-sm md:text-base text-body">
        How the app words things on your behalf.
      </p>

      {settings.error ? (
        <ErrorState
          message="Couldn't load your settings."
          onRetry={() => void settings.refetch()}
        />
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ shareText: value });
        }}
      >
        <fieldset className="border-0 p-0 m-0 border-t-3 border-ink pt-5">
          <legend className="label-caps mb-1.5">Sharing text</legend>
          <p className="mb-3 max-w-[520px] text-sm text-body">
            What &ldquo;Share&rdquo; puts in the message. {SHARE_TEMPLATE_TOKENS.join(' ')} are
            filled in for you — <code>{'{venue}'}</code> and <code>{'{when}'}</code> bring their
            own wording and disappear when the event has neither.
          </p>

          <label className="sr-only" htmlFor="share-text">Sharing text</label>
          <textarea
            id="share-text"
            value={value}
            onChange={(e) => setShareText(e.target.value)}
            rows={3}
            maxLength={400}
            className="field w-full max-w-[560px]"
          />

          <div className="mt-4 border-2 border-ink bg-panel p-3.5 max-w-[560px]">
            <p className="label-caps mb-1.5">Preview</p>
            <p data-testid="share-preview" className="m-0 text-sm text-ink">
              {inviteText(PREVIEW_EVENT, value)}
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button type="submit" disabled={save.isPending} className="btn-fill">
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            {isDefault ? null : (
              <button
                type="button"
                onClick={() => setShareText(DEFAULT_SHARE_TEMPLATE)}
                className="act act-sm"
              >
                Reset to default
              </button>
            )}
            {justSaved ? <span className="text-sm font-bold text-accent">Saved.</span> : null}
            {save.error ? <span className="text-sm text-accent">{save.error.message}</span> : null}
          </div>
        </fieldset>
      </form>
    </section>
  );
}

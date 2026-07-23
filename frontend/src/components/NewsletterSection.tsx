import { useEffect, useState } from 'react';
import type { NewsletterFrequency } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { ErrorState, SkeletonList } from './states';

/** "No time filter" sentinel for the after-hour select. */
const ANY = 'any';
const AFTER_HOURS = [15, 16, 17, 18, 19, 20];

/**
 * /my — "Newsletter" (GOI-8): get the events you follow as an email brief.
 * The user picks the address, cadence (daily/weekly), which of their venues
 * the brief covers, and optionally "only events after N o'clock".
 */
export function NewsletterSection({ defaultEmail }: { defaultEmail: string }) {
  const settings = trpc.my.newsletter.get.useQuery();
  const venues = trpc.my.venues.list.useQuery();

  if (settings.isLoading || venues.isLoading) {
    return (
      <section>
        <h2 className="mb-6 font-serif text-2xl tracking-tight">Newsletter</h2>
        <SkeletonList rows={2} />
      </section>
    );
  }
  if (settings.error || venues.error) {
    return (
      <section>
        <h2 className="mb-6 font-serif text-2xl tracking-tight">Newsletter</h2>
        <ErrorState
          message="Couldn't load your newsletter settings."
          onRetry={() => { void settings.refetch(); void venues.refetch(); }}
        />
      </section>
    );
  }
  return (
    <NewsletterForm
      defaultEmail={defaultEmail}
      saved={settings.data ?? null}
      venues={venues.data ?? []}
    />
  );
}

interface SavedSettings {
  email: string;
  frequency: NewsletterFrequency;
  venueIds: string[];
  afterHour: number | null;
  enabled: boolean;
}

function NewsletterForm({
  defaultEmail,
  saved,
  venues,
}: {
  defaultEmail: string;
  saved: SavedSettings | null;
  venues: { id: string; name: string }[];
}) {
  const [email, setEmail] = useState(saved?.email ?? defaultEmail);
  const [frequency, setFrequency] = useState<NewsletterFrequency>(saved?.frequency ?? 'weekly');
  const [venueIds, setVenueIds] = useState<string[]>(saved?.venueIds ?? []);
  const [afterHour, setAfterHour] = useState<string>(saved?.afterHour != null ? String(saved.afterHour) : ANY);
  const [enabled, setEnabled] = useState(saved?.enabled ?? true);
  const [justSaved, setJustSaved] = useState(false);

  // The login email can arrive after the form mounts (auth.me resolves in
  // parallel with the settings query) — adopt it as long as the field is
  // still empty and nothing was saved before.
  useEffect(() => {
    if (!saved && email === '' && defaultEmail) setEmail(defaultEmail);
  }, [saved, email, defaultEmail]);

  // Flash "Saved" briefly after a successful save.
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(t);
  }, [justSaved]);

  const utils = trpc.useUtils();
  const save = trpc.my.newsletter.save.useMutation({
    onSuccess: async () => {
      setJustSaved(true);
      await utils.my.newsletter.get.invalidate();
    },
  });

  const toggleVenue = (id: string) =>
    setVenueIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  return (
    <section>
      <h2 className="mb-2 font-serif text-2xl tracking-tight">Newsletter</h2>
      <p className="mb-6 text-sm text-muted max-w-prose">
        Get what&rsquo;s on at your venues as an email brief — e.g. Kino Muranów and Kinoteka,
        every day, everything after 6&nbsp;pm.
      </p>

      <form
        className="space-y-4 max-w-prose"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            email: email.trim(),
            frequency,
            venueIds,
            afterHour: afterHour === ANY ? null : Number(afterHour),
            enabled,
          });
        }}
      >
        <div className="flex flex-wrap gap-3">
          <label className="sr-only" htmlFor="newsletter-email">Email address</label>
          <input
            id="newsletter-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 min-w-[14rem] border border-rule bg-paper px-3 py-2 text-sm"
          />
          <label className="sr-only" htmlFor="newsletter-frequency">How often</label>
          <select
            id="newsletter-frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as NewsletterFrequency)}
            className="border border-rule bg-paper px-3 py-2 text-sm"
          >
            <option value="daily">Every day</option>
            <option value="weekly">Weekly (Mondays)</option>
          </select>
          <label className="sr-only" htmlFor="newsletter-after">Only events after</label>
          <select
            id="newsletter-after"
            value={afterHour}
            onChange={(e) => setAfterHour(e.target.value)}
            className="border border-rule bg-paper px-3 py-2 text-sm"
          >
            <option value={ANY}>Any time</option>
            {AFTER_HOURS.map((h) => (
              <option key={h} value={h}>After {h}:00</option>
            ))}
          </select>
        </div>

        <fieldset className="border-0 m-0 p-0">
          <legend className="text-sm text-muted mb-2">
            Venues in the brief {venueIds.length === 0 ? '(none picked — all your venues)' : ''}
          </legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {venues.map((v) => (
              <label key={v.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={venueIds.includes(v.id)}
                  onChange={() => toggleVenue(v.id)}
                />
                {v.name}
              </label>
            ))}
            {venues.length === 0 ? (
              <span className="text-sm text-muted">Add venues to your list first.</span>
            ) : null}
          </div>
        </fieldset>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Newsletter enabled
          </label>
          <button
            type="submit"
            disabled={save.isPending}
            className="link-accent text-sm bg-transparent border border-rule px-4 py-2 cursor-pointer disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save newsletter'}
          </button>
          {justSaved ? <span className="text-sm text-muted">Saved.</span> : null}
          {save.error ? <span className="text-sm text-muted">{save.error.message}</span> : null}
        </div>
      </form>
    </section>
  );
}

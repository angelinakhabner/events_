import { useEffect, useMemo, useState } from 'react';
import type {
  NewsletterCategoryRule, NewsletterDetail, NewsletterFrequency, NewsletterSettings,
} from '@goin/shared';
import { trpc } from '../lib/trpc';
import { ErrorState, SkeletonList } from './states';

/** "No time filter" sentinel for the after-hour select. */
const ANY = 'any';
/** Every hour of the day, for both the send time and the "only after" filter.
 *  The send sweep ticks hourly, so whole hours are exactly what it can honour. */
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

/** Small inline clock, so the send time reads as a time at a glance. */
function ClockIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      aria-hidden focusable="false" className="shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * /my → "Newsletter" (GOI-8, extended by GOI-28): the events you follow as an
 * email brief. You pick the address, when it goes out (every day at a time, or
 * weekly on a chosen day and time), which of your venues it covers, which
 * events it includes and an optional "only after N o'clock" — then hit
 * Generate to see exactly what the next brief would say.
 */
export function NewsletterSection({ defaultEmail }: { defaultEmail: string }) {
  const settings = trpc.my.newsletter.get.useQuery();
  // Straight from "My venues" — same source, same folders, same tags — so the
  // brief can only ever cover venues you actually follow.
  const venues = trpc.my.venues.listAll.useQuery();
  const folders = trpc.my.lists.list.useQuery();

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
      folders={folders.data ?? []}
    />
  );
}

interface PickableVenue {
  id: string;
  name: string;
  category: string;
  listId: string | null;
  tags: string[];
}

function NewsletterForm({
  defaultEmail,
  saved,
  venues,
  folders,
}: {
  defaultEmail: string;
  saved: NewsletterSettings | null;
  venues: PickableVenue[];
  folders: { id: string; name: string }[];
}) {
  const [email, setEmail] = useState(saved?.email ?? defaultEmail);
  const [recipientName, setRecipientName] = useState(saved?.recipientName ?? '');
  const [frequency, setFrequency] = useState<NewsletterFrequency>(saved?.frequency ?? 'weekly');
  const [sendHour, setSendHour] = useState(saved?.sendHour ?? 8);
  const [sendWeekday, setSendWeekday] = useState(saved?.sendWeekday ?? 1);
  const [venueIds, setVenueIds] = useState<string[]>(saved?.venueIds ?? []);
  const [rules, setRules] = useState<NewsletterCategoryRule[]>(saved?.categoryRules ?? []);
  const [afterHour, setAfterHour] = useState<string>(saved?.afterHour != null ? String(saved.afterHour) : ANY);
  const [enabled, setEnabled] = useState(saved?.enabled ?? true);
  const [justSaved, setJustSaved] = useState(false);

  /** Venues grouped under their folder, mirroring the "My venues" tab. */
  const byFolder = useMemo(() => {
    const groups = folders.map((f) => ({
      id: f.id as string | null,
      name: f.name,
      venues: venues.filter((v) => v.listId === f.id),
    }));
    const unfiled = venues.filter((v) => !folders.some((f) => f.id === v.listId));
    if (unfiled.length) groups.push({ id: null, name: 'Unfiled', venues: unfiled });
    return groups.filter((g) => g.venues.length > 0);
  }, [venues, folders]);

  /**
   * Everything a rule can name: the built-in event categories your venues
   * actually cover, plus every tag you have put on one. Both work the same
   * way, so they share one list.
   */
  const allCategories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of venues) {
      if (!seen.has(v.category.toLowerCase())) seen.set(v.category.toLowerCase(), v.category);
      for (const tag of v.tags) {
        if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [venues]);

  /** Categories not yet spoken for — a rule each is the useful maximum. */
  const unusedCategories = allCategories.filter(
    (c) => !rules.some((r) => r.category.toLowerCase() === c.toLowerCase()),
  );

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
  const preview = trpc.my.newsletter.preview.useMutation();

  const payload = () => ({
    email: email.trim(),
    recipientName: recipientName.trim() || null,
    frequency,
    sendHour,
    sendWeekday,
    venueIds,
    categoryRules: rules,
    afterHour: afterHour === ANY ? null : Number(afterHour),
    enabled,
  });

  const toggleVenue = (id: string) =>
    setVenueIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  const addRule = (category: string) =>
    setRules((prev) => [...prev, { category, frequency: 'weekly', detail: 'short' }]);
  const patchRule = (i: number, patch: Partial<NewsletterCategoryRule>) =>
    setRules((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => setRules((prev) => prev.filter((_, n) => n !== i));

  return (
    <section>
      <h2 className="mb-2 font-serif text-2xl tracking-tight">Newsletter</h2>
      <p className="mb-6 text-sm text-muted max-w-prose">
        Get what&rsquo;s on at your venues as an email brief — e.g. Kino Muranów and Kinoteka,
        every day at 08:00, everything after 6&nbsp;pm.
      </p>

      <form
        className="space-y-6 max-w-prose"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(payload());
        }}
      >
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[14rem]">
            <label className="block text-xs uppercase tracking-widest text-muted mb-1" htmlFor="newsletter-email">
              Email address
            </label>
            <input
              id="newsletter-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label className="block text-xs uppercase tracking-widest text-muted mb-1" htmlFor="newsletter-name">
              Your name (optional)
            </label>
            <input
              id="newsletter-name"
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Ania"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted">
              The brief opens with &ldquo;Hi {recipientName.trim() || '…'}&rdquo; — leave it empty to skip the name.
            </p>
          </div>
        </div>

        <fieldset className="border-0 m-0 p-0">
          <legend className="text-xs uppercase tracking-widest text-muted mb-2">When it goes out</legend>
          <div className="flex flex-wrap items-center gap-3">
            <label className="sr-only" htmlFor="newsletter-frequency">How often</label>
            <select
              id="newsletter-frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as NewsletterFrequency)}
              className="border border-rule bg-paper px-3 py-2 text-sm"
            >
              <option value="daily">Every day</option>
              <option value="weekly">Weekly</option>
            </select>

            {frequency === 'weekly' ? (
              <>
                <label className="sr-only" htmlFor="newsletter-weekday">Day of the week</label>
                <select
                  id="newsletter-weekday"
                  value={sendWeekday}
                  onChange={(e) => setSendWeekday(Number(e.target.value))}
                  className="border border-rule bg-paper px-3 py-2 text-sm"
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </>
            ) : null}

            <label className="sr-only" htmlFor="newsletter-send-hour">Time of day</label>
            <span className="inline-flex items-center gap-2 border border-rule bg-paper px-3 py-2 text-muted">
              <ClockIcon />
              <select
                id="newsletter-send-hour"
                value={sendHour}
                onChange={(e) => setSendHour(Number(e.target.value))}
                className="border-0 bg-transparent text-sm text-ink focus:outline-none"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>at {hourLabel(h)}</option>
                ))}
              </select>
            </span>
          </div>
        </fieldset>

        <fieldset className="border-0 m-0 p-0">
          <legend className="text-xs uppercase tracking-widest text-muted mb-2">
            Venues from my venues {venueIds.length === 0 ? '(none picked — all of them)' : ''}
          </legend>
          {byFolder.map((folder) => (
            <div key={folder.id ?? 'unfiled'} className="mb-3">
              <p className="mb-1 text-xs text-muted">{folder.name}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {folder.venues.map((v) => (
                  <label key={v.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={venueIds.includes(v.id)}
                      onChange={() => toggleVenue(v.id)}
                    />
                    {v.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {venues.length === 0 ? (
            <span className="text-sm text-muted">Add venues under &ldquo;My venues&rdquo; first.</span>
          ) : null}
        </fieldset>

        <fieldset className="border-0 m-0 p-0">
          <legend className="text-xs uppercase tracking-widest text-muted mb-2">
            How often, per category
          </legend>
          <p className="mb-3 text-sm text-muted max-w-prose">
            Give a category its own rhythm and depth — cinema every day in brief, museums
            once a month with the full write-up. Categories are your venues&rsquo; own
            categories and any tags you added to them. With none set, one brief covers
            everything on the schedule above.
          </p>

          {rules.length > 0 ? (
            <ul className="mb-3 divide-y divide-rule border-y border-rule list-none m-0 p-0">
              {rules.map((rule, i) => (
                <li key={`${rule.category}-${i}`} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-[7rem] text-sm text-ink">{rule.category}</span>

                  <label className="sr-only" htmlFor={`rule-freq-${i}`}>
                    How often for {rule.category}
                  </label>
                  <select
                    id={`rule-freq-${i}`}
                    value={rule.frequency}
                    onChange={(e) => patchRule(i, { frequency: e.target.value as NewsletterFrequency })}
                    className="border border-rule bg-paper px-2 py-1 text-sm"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>

                  <label className="sr-only" htmlFor={`rule-detail-${i}`}>
                    Description for {rule.category}
                  </label>
                  <select
                    id={`rule-detail-${i}`}
                    value={rule.detail}
                    onChange={(e) => patchRule(i, { detail: e.target.value as NewsletterDetail })}
                    className="border border-rule bg-paper px-2 py-1 text-sm"
                  >
                    <option value="short">Short description</option>
                    <option value="full">Wide description</option>
                  </select>

                  <button
                    type="button"
                    aria-label={`Remove ${rule.category}`}
                    onClick={() => removeRule(i)}
                    className="ml-auto text-sm text-muted hover:text-ink bg-transparent border-0 cursor-pointer"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {allCategories.length === 0 ? (
            <p className="text-sm text-muted">
              Categories come from your venues and the tags you put on them — add a venue
              under &ldquo;My venues&rdquo; first.
            </p>
          ) : unusedCategories.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="add-rule">Add a category</label>
              <select
                id="add-rule"
                value=""
                onChange={(e) => { if (e.target.value) addRule(e.target.value); }}
                className="border border-rule bg-paper px-2 py-1 text-sm"
              >
                <option value="">+ Add a category…</option>
                {unusedCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-muted">Every category has a rule.</p>
          )}
        </fieldset>

        <div>
          <label className="block text-xs uppercase tracking-widest text-muted mb-1" htmlFor="newsletter-after">
            Only events after
          </label>
          <select
            id="newsletter-after"
            value={afterHour}
            onChange={(e) => setAfterHour(e.target.value)}
            className="border border-rule bg-paper px-3 py-2 text-sm"
          >
            <option value={ANY}>Any time</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>After {hourLabel(h)}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Newsletter enabled
          </label>
          <button
            type="submit"
            disabled={save.isPending}
            className="link-accent text-sm bg-transparent border border-rule px-4 py-2 cursor-pointer disabled:opacity-50"
          >
            {save.isPending ? 'Scheduling…' : 'Schedule newsletter'}
          </button>
          <button
            type="button"
            onClick={() => preview.mutate(payload())}
            disabled={preview.isPending}
            className="text-sm text-muted hover:text-ink bg-transparent border border-rule px-4 py-2 cursor-pointer disabled:opacity-50"
          >
            {preview.isPending ? 'Generating…' : 'Generate now'}
          </button>
          {justSaved ? <span className="text-sm text-muted">Saved.</span> : null}
          {save.error ? <span className="text-sm text-muted">{save.error.message}</span> : null}
        </div>
      </form>

      <NewsletterPreview
        html={preview.data?.html ?? null}
        count={preview.data?.events.length ?? null}
        error={preview.error?.message ?? null}
      />
    </section>
  );
}

/**
 * The generated brief, shown exactly as the recipient will see it.
 *
 * It goes in an iframe rather than inline: the renderer returns a complete
 * email *document* (doctype, head, its own body background), which a browser
 * would strip and mangle if injected into the page — and the email's own
 * styles would sit in the same cascade as the app's. `sandbox` with no tokens
 * also means the markup gets no script or navigation privileges, which is the
 * right posture for content that embeds venue-authored titles.
 */
function NewsletterPreview({
  html,
  count,
  error,
}: {
  html: string | null;
  count: number | null;
  error: string | null;
}) {
  if (error) return <p className="mt-6 text-sm text-red-700">Couldn&rsquo;t generate a preview: {error}</p>;
  if (html === null) return null;
  return (
    <div className="mt-8">
      <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">
        Preview{count !== null ? ` — ${count} event${count === 1 ? '' : 's'}` : ''}
      </h3>
      <iframe
        data-testid="newsletter-preview"
        title="Newsletter preview"
        srcDoc={html}
        sandbox=""
        className="w-full max-w-[640px] h-[720px] border border-rule bg-white"
      />
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { NewsletterEventDayMode, NewsletterFrequency, NewsletterSettings } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { ErrorState, SkeletonList } from './states';

/** "No time filter" sentinel for the after-hour select. */
const ANY = 'any';
const AFTER_HOURS = [15, 16, 17, 18, 19, 20];
/** Hours a brief can be sent at — early enough to plan the evening. */
const SEND_HOURS = [6, 7, 8, 9, 10, 12, 17, 18, 19, 20];
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

/**
 * /my → "Newsletter" (GOI-8, extended by GOI-28): the events you follow as an
 * email brief. You pick the address, when it goes out (every day at a time, or
 * weekly on a chosen day and time), which of your venues it covers, which
 * events it includes and an optional "only after N o'clock" — then hit
 * Generate to see exactly what the next brief would say.
 */
export function NewsletterSection({ defaultEmail }: { defaultEmail: string }) {
  const settings = trpc.my.newsletter.get.useQuery();
  const venues = trpc.my.venues.listAll.useQuery();

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

function NewsletterForm({
  defaultEmail,
  saved,
  venues,
}: {
  defaultEmail: string;
  saved: NewsletterSettings | null;
  venues: { id: string; name: string }[];
}) {
  const [email, setEmail] = useState(saved?.email ?? defaultEmail);
  const [frequency, setFrequency] = useState<NewsletterFrequency>(saved?.frequency ?? 'weekly');
  const [sendHour, setSendHour] = useState(saved?.sendHour ?? 8);
  const [sendWeekday, setSendWeekday] = useState(saved?.sendWeekday ?? 1);
  const [venueIds, setVenueIds] = useState<string[]>(saved?.venueIds ?? []);
  const [eventDayMode, setEventDayMode] = useState<NewsletterEventDayMode>(saved?.eventDayMode ?? 'all');
  const [eventDay, setEventDay] = useState(saved?.eventDay ?? 1);
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
  const preview = trpc.my.newsletter.preview.useMutation();

  const payload = () => ({
    email: email.trim(),
    frequency,
    sendHour,
    sendWeekday,
    venueIds,
    eventDayMode,
    eventDay: eventDayMode === 'specific' ? eventDay : null,
    afterHour: afterHour === ANY ? null : Number(afterHour),
    enabled,
  });

  const toggleVenue = (id: string) =>
    setVenueIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  const radio = 'flex items-center gap-2 text-sm cursor-pointer';

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
        <div>
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
            <select
              id="newsletter-send-hour"
              value={sendHour}
              onChange={(e) => setSendHour(Number(e.target.value))}
              className="border border-rule bg-paper px-3 py-2 text-sm"
            >
              {SEND_HOURS.map((h) => (
                <option key={h} value={h}>at {hourLabel(h)}</option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset className="border-0 m-0 p-0">
          <legend className="text-xs uppercase tracking-widest text-muted mb-2">
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

        <fieldset className="border-0 m-0 p-0">
          <legend className="text-xs uppercase tracking-widest text-muted mb-2">Which events</legend>
          <div className="space-y-2">
            <label className={radio}>
              <input
                type="radio"
                name="event-day-mode"
                checked={eventDayMode === 'all'}
                onChange={() => setEventDayMode('all')}
              />
              All the events
            </label>
            <label className={radio}>
              <input
                type="radio"
                name="event-day-mode"
                checked={eventDayMode === 'daily'}
                onChange={() => setEventDayMode('daily')}
              />
              Only events happening every day
            </label>
            <label className={radio}>
              <input
                type="radio"
                name="event-day-mode"
                checked={eventDayMode === 'specific'}
                onChange={() => setEventDayMode('specific')}
              />
              Only events on a specific day
              <span className="sr-only">of the week</span>
            </label>
            {eventDayMode === 'specific' ? (
              <div className="pl-6">
                <label className="sr-only" htmlFor="newsletter-event-day">Which day</label>
                <select
                  id="newsletter-event-day"
                  value={eventDay}
                  onChange={(e) => setEventDay(Number(e.target.value))}
                  className="border border-rule bg-paper px-3 py-2 text-sm"
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
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
            {AFTER_HOURS.map((h) => (
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
            {save.isPending ? 'Saving…' : 'Save newsletter'}
          </button>
          <button
            type="button"
            onClick={() => preview.mutate(payload())}
            disabled={preview.isPending}
            className="text-sm text-muted hover:text-ink bg-transparent border border-rule px-4 py-2 cursor-pointer disabled:opacity-50"
          >
            {preview.isPending ? 'Generating…' : 'Generate'}
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
 * The generated brief, rendered as the recipient would see it. The HTML comes
 * from the same renderer the sender uses and is built entirely server-side
 * from our own event rows — no user-authored markup reaches it (titles are
 * escaped in `renderBriefHtml`).
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
    <div className="mt-8 max-w-prose">
      <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">
        Preview{count !== null ? ` — ${count} event${count === 1 ? '' : 's'}` : ''}
      </h3>
      <div
        data-testid="newsletter-preview"
        className="border border-rule p-4 text-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

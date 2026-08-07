import { useEffect, useMemo, useState } from 'react';
import type {
  NewsletterCategoryRule, NewsletterDetail, NewsletterFrequency, NewsletterSettings,
} from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { downloadText } from '../lib/download';
import { categoryOrTagLabel, pad } from '../lib/format';
import { briefSummary } from '../lib/newsletter';
import { PanelHeading } from './PanelHeading';
import { ErrorState, SkeletonList } from './states';

/** "No time filter" sentinel for the after-hour select. */
const ANY = 'any';
/** Every hour of the day, for both the send time and the "only after" filter. */
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** …and every minute past the hour. The sweep ticks every minute, so all 1440
 *  send times are ones it can actually honour. */
const MINUTES = Array.from({ length: 60 }, (_, m) => m);
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
      aria-hidden focusable="false" className="shrink-0 text-muted"
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
        <PanelHeading title="Newsletter" />
        <SkeletonList rows={2} />
      </section>
    );
  }
  if (settings.error || venues.error) {
    return (
      <section>
        <PanelHeading title="Newsletter" />
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
  const [sendMinute, setSendMinute] = useState(saved?.sendMinute ?? 0);
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
  // GOI-45: generating also drops the brief on disk, ready to paste or
  // attach into whatever the user actually sends mail from.
  const preview = trpc.my.newsletter.preview.useMutation({
    onSuccess: (data) => downloadBrief(data.html),
  });

  const payload = () => ({
    email: email.trim(),
    recipientName: recipientName.trim() || null,
    frequency,
    sendHour,
    sendMinute,
    sendWeekday,
    venueIds,
    categoryRules: rules,
    afterHour: afterHour === ANY ? null : Number(afterHour),
    enabled,
  });

  /** The heading's one-line description of the brief, from live form state. */
  const summary = briefSummary({
    venueNames: venues.filter((v) => venueIds.includes(v.id)).map((v) => v.name),
    frequency,
    sendHour,
    sendMinute,
    sendWeekday,
    afterHour: afterHour === ANY ? null : Number(afterHour),
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
      {/* Describes the brief you have actually set up, and follows every edit.
          It used to be a fixed example printed directly above controls that
          said something else — "every day at 08:00" over a form set to 15:00
          (GOI-30). */}
      <PanelHeading title="Newsletter" blurb={summary} rule={false} />

      <form
        className="max-w-[640px] border-t-3 border-ink"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(payload());
        }}
      >
        <FormSection step={1} label="Contact">
          <div className="flex flex-wrap gap-5">
            <div className="flex-1 min-w-[14rem]">
              <label className="label-caps mb-1.5" htmlFor="newsletter-email">
                Email address
              </label>
              <input
                id="newsletter-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="field"
              />
            </div>
            <div className="flex-1 min-w-[10rem]">
              <label className="label-caps mb-1.5" htmlFor="newsletter-name">
                Your name <span className="font-semibold text-faint">(optional)</span>
              </label>
              <input
                id="newsletter-name"
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Ania"
                className="field"
              />
              <p className="mt-1.5 text-xs text-faint">
                The brief opens with &ldquo;Hi {recipientName.trim() || '\u2026'}&rdquo; — leave it empty to skip the name.
              </p>
            </div>
          </div>
        </FormSection>

        <FormSection step={2} label="When it goes out">
          <div className="flex flex-wrap items-center gap-3.5">
            <label className="sr-only" htmlFor="newsletter-frequency">How often</label>
            <select
              id="newsletter-frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as NewsletterFrequency)}
              className="field-sm font-extrabold uppercase tracking-[0.5px] text-xs cursor-pointer"
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
                  className="field-sm font-extrabold uppercase tracking-[0.5px] text-xs cursor-pointer"
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </>
            ) : null}

            <span className="inline-flex items-center gap-2 border-2 border-ink px-3 py-1.5">
              <ClockIcon />
              <label className="sr-only" htmlFor="newsletter-send-hour">Hour</label>
              <select
                id="newsletter-send-hour"
                value={sendHour}
                onChange={(e) => setSendHour(Number(e.target.value))}
                className="border-0 bg-transparent p-0 text-sm font-bold text-ink cursor-pointer focus:outline-none"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{pad(h)}</option>
                ))}
              </select>
              <span aria-hidden className="text-sm font-bold">:</span>
              <label className="sr-only" htmlFor="newsletter-send-minute">Minute</label>
              <select
                id="newsletter-send-minute"
                value={sendMinute}
                onChange={(e) => setSendMinute(Number(e.target.value))}
                className="border-0 bg-transparent p-0 text-sm font-bold text-ink cursor-pointer focus:outline-none"
              >
                {MINUTES.map((m) => (
                  <option key={m} value={m}>{pad(m)}</option>
                ))}
              </select>
            </span>

            {/* The same time again, at poster scale — the one number you check
                before closing the page. */}
            <span aria-hidden className="font-display text-xl md:text-[22px]">
              AT {pad(sendHour)}:{pad(sendMinute)}
            </span>
          </div>
          <p className="mt-2.5 text-xs text-faint">
            Warsaw time — next brief at {pad(sendHour)}:{pad(sendMinute)}
            {frequency === 'weekly' ? ` on ${WEEKDAYS.find((d) => d.value === sendWeekday)?.label}` : ', every day'}.
          </p>
        </FormSection>

        <FormSection
          step={3}
          label="Venues from my venues"
          note={venueIds.length === 0 ? 'None picked — the brief covers all of them.' : undefined}
        >
          {byFolder.map((folder) => (
            <div key={folder.id ?? 'unfiled'} className="mb-4 last:mb-0">
              <p className="mb-2 tag">{folder.name}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2.5">
                {folder.venues.map((v) => (
                  <label key={v.id} className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={venueIds.includes(v.id)}
                      onChange={() => toggleVenue(v.id)}
                      className="checkbox"
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
        </FormSection>

        <FormSection
          step={4}
          label="How often, per category"
          note="Give a category its own rhythm and depth — cinema every day in brief, museums once a month with the full write-up. Categories are your venues' own categories and any tags you added to them."
        >
          {rules.length > 0 ? (
            <>
              {/* Column headings, desktop only: the rows stack below `md`, where
                  a four-column header would label nothing. */}
              <div className="hidden md:flex label-caps border-b-2 border-ink pb-2">
                <span className="w-[120px]">Category</span>
                <span className="w-[100px]">Frequency</span>
                <span className="flex-1">Depth</span>
                <span className="w-[60px]" />
              </div>
              <ul className="mb-3.5 list-none m-0 p-0">
                {rules.map((rule, i) => (
                  <li
                    key={`${rule.category}-${i}`}
                    className="flex flex-wrap items-center gap-3 py-2.5 rule-soft text-[13px]"
                  >
                    <span className="md:w-[120px] font-bold">{categoryOrTagLabel(rule.category)}</span>

                    <label className="sr-only" htmlFor={`rule-freq-${i}`}>
                      How often for {categoryOrTagLabel(rule.category)}
                    </label>
                    <select
                      id={`rule-freq-${i}`}
                      value={rule.frequency}
                      onChange={(e) => patchRule(i, { frequency: e.target.value as NewsletterFrequency })}
                      className="field-sm md:w-[100px] cursor-pointer"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>

                    <label className="sr-only" htmlFor={`rule-detail-${i}`}>
                      Description for {categoryOrTagLabel(rule.category)}
                    </label>
                    <select
                      id={`rule-detail-${i}`}
                      value={rule.detail}
                      onChange={(e) => patchRule(i, { detail: e.target.value as NewsletterDetail })}
                      className="field-sm md:flex-1 cursor-pointer"
                    >
                      <option value="short">Short description</option>
                      <option value="full">Wide description</option>
                    </select>

                    <button
                      type="button"
                      aria-label={`Remove ${categoryOrTagLabel(rule.category)}`}
                      onClick={() => removeRule(i)}
                      className="act act-sm ml-auto md:w-[60px] md:text-left"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {allCategories.length === 0 ? (
            <p className="text-sm text-muted">
              Categories come from your venues and the tags you put on them — add a venue
              under &ldquo;My venues&rdquo; first.
            </p>
          ) : unusedCategories.length > 0 ? (
            <>
              <label className="sr-only" htmlFor="add-rule">Add a category</label>
              <select
                id="add-rule"
                value=""
                onChange={(e) => { if (e.target.value) addRule(e.target.value); }}
                className="bg-transparent border-0 p-0 text-xs font-bold uppercase tracking-[0.5px] text-accent cursor-pointer focus:outline-none"
              >
                <option value="">+ Add a category…</option>
                {unusedCategories.map((c) => (
                  <option key={c} value={c}>{categoryOrTagLabel(c)}</option>
                ))}
              </select>
            </>
          ) : (
            <p className="text-sm text-muted">Every category has a rule.</p>
          )}
        </FormSection>

        <FormSection step={5} label="Only events after">
          <div className="flex items-center gap-3.5">
            <select
              id="newsletter-after"
              aria-label="Only events after"
              value={afterHour}
              onChange={(e) => setAfterHour(e.target.value)}
              className="field-sm font-extrabold uppercase tracking-[0.5px] text-xs cursor-pointer"
            >
              <option value={ANY}>Any time</option>
              {HOURS.map((h) => (
                <option key={h} value={h}>After {hourLabel(h)}</option>
              ))}
            </select>
            <span aria-hidden className="font-display text-xl md:text-[22px]">
              {afterHour === ANY ? 'ANY TIME' : hourLabel(Number(afterHour))}
            </span>
          </div>
        </FormSection>

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3.5 border-t-3 border-ink pt-5">
          <button
            type="button"
            aria-pressed={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`bg-transparent border-0 p-0 cursor-pointer text-[13px] font-extrabold uppercase tracking-[1px] text-left ${
              enabled ? 'text-accent' : 'text-muted hover:text-ink'
            }`}
          >
            {enabled ? '● Newsletter enabled' : 'Enable newsletter'}
          </button>
          <div className="flex flex-col md:flex-row gap-3.5">
            <button type="submit" disabled={save.isPending} className="btn-outline text-center">
              {save.isPending ? 'Scheduling…' : 'Schedule newsletter'}
            </button>
            <button
              type="button"
              onClick={() => preview.mutate(payload())}
              disabled={preview.isPending}
              className="btn-fill text-center"
            >
              {preview.isPending ? 'Generating…' : 'Generate now'}
            </button>
          </div>
        </div>
        {justSaved ? <p className="mt-3 text-sm font-bold text-accent">Saved.</p> : null}
        {save.error ? <p className="mt-3 text-sm text-accent">{save.error.message}</p> : null}
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
 * One block of the form, in the two shapes the design pack asks for.
 *
 * Desktop is a plain flush-left label with a light rule above it, so the whole
 * form reads as one continuous sheet. Below `md` the label becomes a numbered
 * black bar ("2 · WHEN IT GOES OUT") — on a narrow screen the sections have to
 * announce themselves, and the count tells you how much form is left.
 *
 * The wrapper is a `fieldset` so the label is a real `legend` for anyone
 * navigating by landmark, not just a styled line of text.
 */
function FormSection({
  step,
  label,
  note,
  children,
}: {
  step: number;
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="border-0 m-0 p-0 md:border-t-2 md:border-rule md:first:border-t-0">
      <legend className="w-full p-0 md:mt-5">
        <span className="block bg-ink px-5 py-2.5 text-[10px] font-extrabold uppercase tracking-[1px] text-white md:hidden">
          {step} · {label}
        </span>
        <span className="hidden md:block label-caps">{label}</span>
      </legend>
      {note ? <p className="mt-1.5 mb-3 px-5 md:px-0 text-xs text-faint max-w-[520px]">{note}</p> : null}
      <div className={`px-5 py-4 md:px-0 md:pb-5 ${note ? '' : 'md:pt-3'}`}>{children}</div>
    </fieldset>
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
  if (error) return <p className="mt-6 text-sm text-accent">Couldn&rsquo;t generate a preview: {error}</p>;
  if (html === null) return null;
  return (
    <div className="mt-10">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3.5">
        <h3 className="label-caps">
          Preview{count !== null ? ` — ${count} event${count === 1 ? '' : 's'}` : ''}
        </h3>
        {/* Generating already saved a copy; this is for when it got lost in
            the downloads folder, or the same brief is wanted twice. */}
        <button type="button" onClick={() => downloadBrief(html)} className="act act-sm">
          Download again
        </button>
      </div>
      <iframe
        data-testid="newsletter-preview"
        title="Newsletter preview"
        srcDoc={html}
        sandbox=""
        className="w-full max-w-[640px] h-[720px] border-3 border-ink bg-white"
      />
    </div>
  );
}

/**
 * Save the rendered brief as a standalone .html file.
 *
 * The renderer already returns a complete email document, so what lands on
 * disk opens in a browser exactly as the recipient would see it — ready to
 * attach, or to open and paste into a mail client. Dated so a week of drafts
 * doesn't collapse onto one filename.
 */
function downloadBrief(html: string): void {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  downloadText(`afisz-brief-${day}.html`, html, 'text/html');
}

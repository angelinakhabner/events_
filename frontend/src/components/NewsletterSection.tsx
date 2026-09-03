import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_DRIVE_FOLDER, MAX_DRIVE_FOLDER_NAME } from '@afisz/shared';
import type {
  NewsletterCategoryRule, NewsletterDelivery, NewsletterDetail, NewsletterRuleCadence,
  NewsletterSendCadence, NewsletterSettings, NewsletterTimeFilter, NewsletterWantToGo,
} from '@afisz/shared';
import {
  allowedRuleCadences, DEFAULT_WANT_TO_GO, deliversByEmail, deliversToDrive, deriveWindow,
} from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { newsletterApiIsStale, OLDER_API, readableApiError } from '../lib/api-error';
import { downloadBase64, downloadText } from '../lib/download';
import { categoryOrTagLabel, pad } from '../lib/format';
import {
  briefSummary, newsletterPayload, NEWSLETTER_BLURB, NEWSLETTER_FIELDS,
} from '../lib/newsletter';
import { PanelHeading } from './PanelHeading';
import { ErrorState, SkeletonList } from './states';

/** Every hour of the day, for the send time. */
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

/** 1-28. Capped so a monthly newsletter has an issue in February too. */
const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => i + 1);

/**
 * The `IN ISSUES` column's options (GOI-102 §2), worded relative to the send
 * schedule rather than absolutely. "Daily" inside a weekly newsletter was a
 * promise the sender could not keep.
 */
const RULE_CADENCES: { value: NewsletterRuleCadence; label: string }[] = [
  { value: 'every_issue', label: 'Every issue' },
  { value: 'weekly', label: 'Once a week' },
  { value: 'monthly', label: 'Once a month' },
];

/** "1st", "2nd", "23rd" — for the day-of-month picker. */
function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** How many days a rule's section will cover, given the envelope carrying it
 *  — the number the LOOK AHEAD field shows as its placeholder. */
function deriveWindowDays(
  sendCadence: NewsletterSendCadence,
  rule: Pick<NewsletterCategoryRule, 'cadence' | 'lookaheadDays'>,
): number {
  const { from, to } = deriveWindow({ sendCadence }, { ...rule, lookaheadDays: null }, new Date());
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
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
      staleApi={newsletterApiIsStale(settings.data)}
      venues={venues.data ?? []}
      folders={folders.data ?? []}
    />
  );
}

/**
 * The API predates this page, said before anything is clicked (GOI-105).
 *
 * Both buttons post the shape this build sends, so against an API that
 * predates GOI-100 both are certain to fail — and the only account of it the
 * reader used to get was two lines of validation errors, after the click,
 * naming fields their screen does not have. The settings the page loaded
 * already carry the answer (`newsletterApiIsStale`), so it is said up front,
 * at the top, where a reader looks before pressing anything.
 *
 * The form is still rendered below it, and both buttons still work: this is a
 * deployment fact about the server, not a reason to take the reader's settings
 * away from them.
 */
function StaleApiBanner() {
  return (
    <div role="alert" className="mb-6 border-3 border-accent bg-panel p-4">
      <p className="label-form text-accent">Newsletter unavailable right now</p>
      <p className="mt-2 max-w-prose text-sm font-semibold">
        Saving and generating will both fail: {OLDER_API} Until then the settings below are
        shown as this page reads them, and may not match what is stored.
      </p>
    </div>
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
  staleApi,
  venues,
  folders,
}: {
  defaultEmail: string;
  saved: NewsletterSettings | null;
  /** The API that served `saved` predates this build — see `StaleApiBanner`. */
  staleApi: boolean;
  venues: PickableVenue[];
  folders: { id: string; name: string }[];
}) {
  const [email, setEmail] = useState(saved?.email ?? defaultEmail);
  const [recipientName, setRecipientName] = useState(saved?.recipientName ?? '');
  const [delivery, setDelivery] = useState<NewsletterDelivery>(saved?.delivery ?? 'email');
  const [sendCadence, setSendCadenceRaw] = useState<NewsletterSendCadence>(saved?.sendCadence ?? 'weekly');
  const [sendHour, setSendHour] = useState(saved?.sendHour ?? 8);
  const [sendMinute, setSendMinute] = useState(saved?.sendMinute ?? 0);
  const [sendWeekday, setSendWeekday] = useState(saved?.sendWeekday ?? 1);
  const [sendDayOfMonth, setSendDayOfMonth] = useState(saved?.sendDayOfMonth ?? 1);
  const [venueIds, setVenueIds] = useState<string[]>(saved?.venueIds ?? []);
  const [rules, setRules] = useState<NewsletterCategoryRule[]>(saved?.categoryRules ?? []);
  /**
   * The only thing left to decide about the saved-events queue is whether it
   * runs (GOI-103). The rest of `NewsletterWantToGo` is still stored and still
   * honoured by the sweep — it is simply not the reader's to tune any more, so
   * a record saved under the old form is normalised back to the defaults here
   * rather than leaving a reader pinned to settings they can no longer see.
   */
  const [wantToGo, setWantToGo] = useState<NewsletterWantToGo>({
    ...DEFAULT_WANT_TO_GO,
    enabled: saved?.wantToGo?.enabled ?? DEFAULT_WANT_TO_GO.enabled,
  });
  const [enabled, setEnabled] = useState(saved?.enabled ?? true);
  const [justSaved, setJustSaved] = useState(false);
  /** What changing the send cadence did to the rules, shown once (GOI-102). */
  const [reconciled, setReconciled] = useState<string[]>([]);

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
   * way and share one namespace, so they share one list — see
   * `eventInCategory`, which is what decides a match.
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

  /**
   * Changing the envelope can invalidate the contents (GOI-102).
   *
   * A category set to "once a week" is unreachable the moment the newsletter
   * itself becomes weekly — every issue already is. The old values are
   * reconciled to the nearest legal one rather than left to fail on save, but
   * *silently* rewriting a reader's choices is how a form loses their trust,
   * so what changed is named above the table until they touch it again.
   */
  const setSendCadence = (next: NewsletterSendCadence) => {
    const allowed = allowedRuleCadences(next);
    const changed: string[] = [];
    setRules((prev) =>
      prev.map((r) => {
        if (allowed.includes(r.cadence)) return r;
        changed.push(categoryOrTagLabel(r.category));
        return { ...r, cadence: 'every_issue' as const, cadenceWeekday: null };
      }),
    );
    setReconciled(changed);
    setSendCadenceRaw(next);
  };

  const utils = trpc.useUtils();
  const save = trpc.my.newsletter.save.useMutation({
    onSuccess: async () => {
      setJustSaved(true);
      setReconciled([]);
      await utils.my.newsletter.get.invalidate();
    },
  });
  // GOI-45: generating also drops the brief on disk, ready to attach to
  // whatever the user actually sends mail from. The PDF is what lands —
  // it is the same artefact the drive copy files (GOI-91), so what they
  // forward by hand and what appears in their folder are the same document.
  const preview = trpc.my.newsletter.preview.useMutation({
    onSuccess: (data) => downloadPdf(data.pdf),
  });
  /**
   * What the form sends, from live state.
   *
   * Built by `newsletterPayload` so it can be tested against the server's
   * schema for every combination of settings, rather than only the handful a
   * rendered test happens to click through (GOI-105).
   *
   * This used to be captured into a ref at request time and handed to
   * `readableApiError` as the thing to read field names off. It is neither
   * job's business now: the names that matter are the ones this build *can*
   * send, which is a static property of the payload's shape
   * (`NEWSLETTER_FIELDS`), not of whatever the form is holding — a live
   * payload can carry a stale API's own fields straight back to it.
   */
  const body = newsletterPayload({
    email,
    recipientName,
    delivery,
    name: saved?.name ?? 'Newsletter',
    sendCadence,
    sendHour,
    sendMinute,
    sendWeekday,
    sendDayOfMonth,
    venueIds,
    rules,
    wantToGo,
    enabled,
  });

  /** The heading's one-line description of the brief, from live form state. */
  const summary = briefSummary({
    venueNames: venues.filter((v) => venueIds.includes(v.id)).map((v) => v.name),
    frequency: sendCadence,
    sendHour,
    sendMinute,
    sendWeekday,
    afterHour: null,
    email,
    delivery,
    enabled,
  });

  const toggleVenue = (id: string) =>
    setVenueIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  const addRule = (category: string) =>
    setRules((prev) => [
      ...prev,
      {
        category,
        cadence: 'every_issue',
        cadenceWeekday: null,
        detail: 'short',
        timeFilter: 'any',
        lookaheadDays: null,
        sortOrder: prev.length,
      },
    ]);
  const patchRule = (i: number, patch: Partial<NewsletterCategoryRule>) =>
    setRules((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => setRules((prev) => prev.filter((_, n) => n !== i));

  /**
   * The one rule the server enforces that the controls cannot prevent
   * (GOI-100 rule 4): a newsletter with no categories and no saved events can
   * never produce content. Surfaced against the table rather than as a toast,
   * so it is beside the thing that has to change.
   */
  const emptyByConstruction = rules.length === 0 && !wantToGo.enabled;

  return (
    <section>
      {staleApi ? <StaleApiBanner /> : null}
      {/* Two lines, deliberately: the heading says what a brief *can* be
          (GOI-97), and the line under it says what yours currently *is*
          (GOI-30), live, following every edit. The old copy tried to be both
          at once and was an example of neither — a fixed "Kino Muranów …
          every day at 08:00" printed over a form set to 15:00. */}
      <PanelHeading title="Newsletter" blurb={NEWSLETTER_BLURB} rule={false} />
      <p className="-mt-3 mb-5 md:mb-6 max-w-[520px] text-sm md:text-base font-semibold text-ink">
        <span className="label-form mr-2 text-faint">Yours</span>
        {summary}
      </p>

      <form
        className="max-w-[640px] border-t-3 border-ink"
        onSubmit={(e) => {
          e.preventDefault();
          if (emptyByConstruction) return;
          save.mutate(body);
        }}
      >
        <FormSection step={1} label="Where it goes">
          <DeliveryChoice value={delivery} onChange={setDelivery} />

          <div className="mt-5 flex flex-wrap gap-5">
            <div className="flex-1 min-w-[14rem]">
              <label className="label-form mb-1.5" htmlFor="newsletter-email">
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
              <label className="label-form mb-1.5" htmlFor="newsletter-name">
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
                The brief opens with &ldquo;Hi {recipientName.trim() || '…'}&rdquo; — leave it empty to skip the name.
              </p>
            </div>
          </div>

          {/* The address is the account either way, so the field stays — but
              saying it is where the brief arrives would be false for someone
              who chose the drive. */}
          {!deliversByEmail(delivery) ? (
            <p className="mt-3 text-xs text-faint">
              Nothing is emailed with this setting. The address stays as your account&rsquo;s, and
              the name is still used to open the PDF.
            </p>
          ) : null}

          {deliversToDrive(delivery) ? <DriveRequiredNote /> : null}
        </FormSection>

        <FormSection
          step={2}
          label="Venues from my venues"
          note={
            venueIds.length === 0
              ? 'None ticked — the newsletter covers every venue in the folders below. Ticking some narrows the newsletter only; your folders are not changed.'
              : 'Ticking narrows the newsletter only. Your folders are not changed, and a venue removed here is still in the folder.'
          }
        >
          {byFolder.map((folder) => (
            <div key={folder.id ?? 'unfiled'} className="mb-4 last:mb-0">
              <p className="mb-2 flex flex-wrap items-baseline gap-2.5">
                <span className="tag">{folder.name}</span>
                {/* GOI-102: adding a venue is the folder's job, not this
                    form's, so the form points at it rather than growing a
                    second way to do it that could disagree. */}
                <a href="/my?tab=venues" className="act act-sm">Add venues</a>
              </p>
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

        {/* GOI-102 §1. The envelope, stated on its own and before the
            contents: how often an issue arrives is a different question from
            what goes in it, and the two used to be one control. */}
        <FormSection step={3} label="When" note="How often an issue arrives. What goes in it is set below.">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3.5">
            <span className="flex items-center gap-2.5">
              <span className="label-caps">Send</span>
              <ScheduleToggle value={sendCadence} onChange={setSendCadence} />
            </span>

            {sendCadence === 'weekly' ? (
              <span className="flex items-center gap-2.5">
                <label className="label-caps" htmlFor="newsletter-weekday">On</label>
                <select
                  id="newsletter-weekday"
                  value={sendWeekday}
                  onChange={(e) => setSendWeekday(Number(e.target.value))}
                  className="select-flat py-[9px]"
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </span>
            ) : null}

            {sendCadence === 'monthly' ? (
              <span className="flex items-center gap-2.5">
                <label className="label-caps" htmlFor="newsletter-day-of-month">On</label>
                <select
                  id="newsletter-day-of-month"
                  value={sendDayOfMonth}
                  onChange={(e) => setSendDayOfMonth(Number(e.target.value))}
                  className="select-flat py-[9px]"
                >
                  {DAYS_OF_MONTH.map((d) => (
                    <option key={d} value={d}>{ordinal(d)}</option>
                  ))}
                </select>
              </span>
            ) : null}

            {/* Clock, hour, minute in one bordered box, divided by the same
                2px ink rules the rest of the system draws with — so the send
                time reads as a single control rather than two dropdowns that
                happen to be adjacent. */}
            <span className="flex items-center gap-2.5">
              <span className="label-caps">At</span>
              <span className="inline-flex items-stretch border-2 border-ink bg-white">
                <span className="flex items-center border-r-2 border-ink px-2.5">
                  <ClockIcon />
                </span>
                <label className="sr-only" htmlFor="newsletter-send-hour">Hour</label>
                <select
                  id="newsletter-send-hour"
                  value={sendHour}
                  onChange={(e) => setSendHour(Number(e.target.value))}
                  className="select-flat-bare border-r-2 border-ink"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{pad(h)}</option>
                  ))}
                </select>
                <span aria-hidden className="flex items-center px-1 text-xs font-extrabold">:</span>
                <label className="sr-only" htmlFor="newsletter-send-minute">Minute</label>
                <select
                  id="newsletter-send-minute"
                  value={sendMinute}
                  onChange={(e) => setSendMinute(Number(e.target.value))}
                  className="select-flat-bare"
                >
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>{pad(m)}</option>
                  ))}
                </select>
              </span>
            </span>
          </div>
          <p className="mt-2.5 text-xs text-faint">
            Warsaw time — next issue at {pad(sendHour)}:{pad(sendMinute)}
            {sendCadence === 'weekly' ? ` on ${WEEKDAYS.find((d) => d.value === sendWeekday)?.label}` : null}
            {sendCadence === 'monthly' ? ` on the ${ordinal(sendDayOfMonth)} of the month` : null}
            {sendCadence === 'daily' ? ', every day' : null}.
          </p>
        </FormSection>

        <FormSection
          step={4}
          label="What goes in it, per category"
          note="Give a category its own rhythm, depth and time of day — cinema in every issue in brief, museums once a month with the full write-up. Categories are your venues' own categories and any tags you added to them."
        >
          {/* Named rather than silent: the reader chose those values, and a
              form that rewrites a choice without saying so is one they stop
              trusting (GOI-102). */}
          {reconciled.length > 0 ? (
            <p role="status" className="mb-3 border-l-3 border-accent pl-3 text-xs text-body">
              {reconciled.join(', ')} moved to <strong>every issue</strong> — a{' '}
              {sendCadence} newsletter cannot carry a category more often than it goes out.
            </p>
          ) : null}

          {rules.length > 0 ? (
            <>
              {/* Column headings, desktop only: the rows stack below `md`, where
                  a five-column header would label nothing. */}
              <div className="hidden md:flex gap-3 label-form border-b-2 border-ink pb-2">
                <span className="w-[110px] shrink-0">Category</span>
                <span className="w-[130px] shrink-0">In issues</span>
                <span className="w-[120px] shrink-0">Time</span>
                <span className="flex-1">Depth</span>
                <span className="w-[54px] shrink-0" />
              </div>
              <ul className="mb-3.5 list-none m-0 p-0">
                {rules.map((rule, i) => (
                  <RuleRow
                    key={`${rule.category}-${i}`}
                    rule={rule}
                    index={i}
                    sendCadence={sendCadence}
                    onPatch={(patch) => patchRule(i, patch)}
                    onRemove={() => removeRule(i)}
                  />
                ))}
              </ul>
            </>
          ) : null}

          {emptyByConstruction ? (
            <p role="alert" className="mb-3 text-sm font-bold text-accent">
              This newsletter would always be empty. Add a category, or turn on saved events below.
            </p>
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
                className="select-chevron border-0 bg-transparent py-3 pl-0 pr-6 text-xs font-bold uppercase tracking-[0.5px] text-accent"
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

        {/* GOI-102 §3 / GOI-101. Not a category, and deliberately not in the
            table above: this is a queue of events the reader already chose,
            escalating as they approach, and it inherits no cadence, depth or
            window from anything. */}
        <FormSection step={5} label="Events you saved">
          {/* GOI-103: one decision, not four.
              GOI-101 shipped this block with a reminder horizon, a
              change-report switch and an urgent-send switch beneath the
              include toggle. Every one of them is a question about machinery
              the reader did not ask to operate — and asked at the point they
              are trying to answer something much simpler, "do my saved events
              turn up in this or not". The queue still behaves exactly as
              GOI-101 built it; it just runs on its defaults now
              (`DEFAULT_WANT_TO_GO`) rather than making its internals the
              reader's problem. */}
          <p className="mb-3.5 max-w-[520px] text-xs text-faint">
            Saved events appear at the top of every issue, with a reminder the day before and a
            warning on the last chance to go. You are told if one is cancelled or moved.
          </p>

          <Check
            id="wtg-enabled"
            checked={wantToGo.enabled}
            onChange={(v) => setWantToGo((w) => ({ ...w, enabled: v }))}
            label="Include events I saved"
          />
        </FormSection>

        {/* Stacked, both left-aligned (design pack): the enabled/disabled
            state is a statement about the brief, not a third button, so it
            reads above the actions rather than across from them. */}
        <div className="flex flex-col items-start gap-3.5 border-t-3 border-ink pt-5">
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
          <div className="flex w-full flex-col md:w-auto md:flex-row gap-3.5">
            <button
              type="submit"
              disabled={save.isPending || emptyByConstruction}
              className="btn-outline text-center"
            >
              {save.isPending ? 'Scheduling…' : 'Schedule newsletter'}
            </button>
            <button
              type="button"
              onClick={() => preview.mutate(body)}
              // Generating validates the same config saving does, so a
              // newsletter the form already calls empty by construction can
              // only come back rejected. Held with the same message beside the
              // table rather than sent to be told so.
              disabled={preview.isPending || emptyByConstruction}
              className="btn-fill text-center"
            >
              {preview.isPending ? 'Generating…' : 'Generate now'}
            </button>
          </div>
        </div>

        {/* GOI-102 §5: the screen used to give no sign that a dropdown change
            had persisted, so "did that save?" had no answer but reloading. */}
        <SaveState
          dirty={!justSaved && (save.isIdle || save.isSuccess)}
          pending={save.isPending}
          justSaved={justSaved}
          error={readableApiError(save.error?.message, NEWSLETTER_FIELDS)}
        />
      </form>

      <NewsletterPreview
        html={preview.data?.html ?? null}
        pdf={preview.data?.pdf ?? null}
        count={preview.data?.events.length ?? null}
        error={readableApiError(preview.error?.message, NEWSLETTER_FIELDS)}
      />

      <DriveCard />
    </section>
  );
}

/**
 * Email, a filed PDF, or both.
 *
 * A radiogroup rather than a set of checkboxes, and rather than a toggle
 * bolted onto the drive card further down. The three options are mutually
 * exclusive and one of them is always in force, which is what a radio group
 * means — and putting the choice at the top of the form, before the address
 * field, is what makes the address field's role legible: for a drive-only
 * reader it is an account name rather than a destination.
 *
 * Drawn as the same bordered strip the send cadence uses, because it is the
 * same kind of choice.
 */
function DeliveryChoice({
  value,
  onChange,
}: {
  value: NewsletterDelivery;
  onChange: (v: NewsletterDelivery) => void;
}) {
  const options: { value: NewsletterDelivery; label: string; hint: string }[] = [
    { value: 'email', label: 'Email', hint: 'The brief arrives in your inbox.' },
    { value: 'drive', label: 'Drive', hint: 'Filed as a PDF. Nothing is emailed.' },
    { value: 'both', label: 'Both', hint: 'Emailed, and filed as a PDF as well.' },
  ];
  const current = options.find((o) => o.value === value);

  return (
    <div>
      <div role="radiogroup" aria-label="How to send it" className="flex border-2 border-ink">
        {options.map((o, i) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={`cursor-pointer px-4 py-[9px] text-xs font-extrabold uppercase tracking-[0.5px] ${
                i < options.length - 1 ? 'border-r-2 border-ink' : ''
              } ${active ? 'bg-ink text-white' : 'bg-transparent text-ink hover:text-accent'}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-faint">{current?.hint}</p>
    </div>
  );
}

/**
 * Says so when the reader has asked for a filed PDF and there is nowhere to
 * file it.
 *
 * The server accepts the setting either way — a reader may reasonably choose
 * it and connect the drive next, and refusing would make the two steps
 * order-dependent for no reason. What it must not be is silent: a `drive`
 * newsletter with nothing connected produces no brief at all, and the reader
 * would have no way to know. The sweep records `no-drive` for the same reason;
 * this is the half of it they can see.
 *
 * **It says something in every state, including "I don't know".** The status
 * query is not reliably answerable — `defaultDriveStore` is the database store
 * unconditionally, so on a deployment without one the query fails and retries,
 * and a component that rendered nothing until it resolved would go quiet
 * exactly where the warning matters most. Silence here reads as approval.
 *
 * It reads the same query the drive card below does, so it costs no extra
 * request.
 */
function DriveRequiredNote() {
  const status = trpc.my.newsletter.drive.status.useQuery();

  if (status.data) {
    if (!status.data.available) {
      return (
        <Note alert>
          Drives aren&rsquo;t available on this deployment, so nothing can be filed. Choose
          &ldquo;Email&rdquo; instead.
        </Note>
      );
    }
    if (status.data.connections.length === 0) {
      return (
        <Note alert>
          No drive is connected yet, so there is nowhere to file the PDF — connect one under
          &ldquo;Save briefs to a drive&rdquo; below. Until you do, no brief will be filed.
        </Note>
      );
    }
    return null;
  }

  // Status unknown. Not an alarm — it may simply not have arrived yet — but
  // not nothing either.
  return (
    <Note>
      Briefs are filed to the drive you connect under &ldquo;Save briefs to a drive&rdquo; below.
      With none connected, nothing is filed.
    </Note>
  );
}

/** A line under the delivery choice. `alert` marks the ones a reader has to
 *  act on, which is also what puts them in the accessibility tree as such. */
function Note({ alert, children }: { alert?: boolean; children: React.ReactNode }) {
  return (
    <p
      {...(alert ? { role: 'alert' as const } : {})}
      className={`mt-3 text-sm ${alert ? 'text-accent' : 'text-faint'}`}
    >
      {children}
    </p>
  );
}

/**
 * One row of the category table (GOI-102 §2).
 *
 * The interesting part is the `IN ISSUES` column. Its options are worded
 * relative to the send schedule — "every issue", not "daily", because "daily"
 * inside a weekly newsletter was a promise the sender could not keep — and the
 * ones the schedule makes impossible are **disabled rather than removed**. A
 * vanished option looks like a bug or a moved control; a greyed one with a
 * reason attached teaches the rule in the place the rule applies.
 */
function RuleRow({
  rule,
  index,
  sendCadence,
  onPatch,
  onRemove,
}: {
  rule: NewsletterCategoryRule;
  index: number;
  sendCadence: NewsletterSendCadence;
  onPatch: (patch: Partial<NewsletterCategoryRule>) => void;
  onRemove: () => void;
}) {
  const [showLookahead, setShowLookahead] = useState(rule.lookaheadDays != null);
  const allowed = allowedRuleCadences(sendCadence);
  const label = categoryOrTagLabel(rule.category);
  // What the reader would be overriding, shown as placeholder text so the
  // field is answerable without arithmetic.
  const derived = deriveWindowDays(sendCadence, rule);
  const why = `A ${sendCadence} newsletter cannot carry a category more often than it goes out.`;

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 rule-soft text-[13px]">
      {/* Caps at the dropdowns' own size and weight — the row is one line of
          type, and a sentence-case name beside caps selects broke it. */}
      <span className="md:w-[110px] md:shrink-0 text-xs font-extrabold uppercase tracking-[0.5px]">
        {label}
      </span>

      <label className="sr-only" htmlFor={`rule-cadence-${index}`}>How often for {label}</label>
      <select
        id={`rule-cadence-${index}`}
        value={rule.cadence}
        onChange={(e) => onPatch({ cadence: e.target.value as NewsletterRuleCadence })}
        className="select-flat md:w-[130px] md:shrink-0"
      >
        {RULE_CADENCES.map((c) => {
          const off = !allowed.includes(c.value);
          return (
            <option key={c.value} value={c.value} disabled={off} title={off ? why : undefined}>
              {off ? `${c.label} —` : c.label}
            </option>
          );
        })}
      </select>

      <label className="sr-only" htmlFor={`rule-time-${index}`}>Time of day for {label}</label>
      <select
        id={`rule-time-${index}`}
        value={rule.timeFilter}
        onChange={(e) => onPatch({ timeFilter: e.target.value as NewsletterTimeFilter })}
        className="select-flat md:w-[120px] md:shrink-0"
      >
        <option value="any">Any time</option>
        <option value="after_17">After 17:00</option>
        <option value="after_18">After 18:00</option>
        <option value="after_19">After 19:00</option>
        <option value="after_20">After 20:00</option>
      </select>

      <label className="sr-only" htmlFor={`rule-detail-${index}`}>Description for {label}</label>
      <select
        id={`rule-detail-${index}`}
        value={rule.detail}
        onChange={(e) => onPatch({ detail: e.target.value as NewsletterDetail })}
        className="select-flat md:flex-1"
      >
        <option value="line">One line</option>
        <option value="short">Short description</option>
        <option value="full">Full description</option>
      </select>

      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="act act-sm ml-auto md:w-[54px] md:shrink-0 md:text-left"
      >
        Remove
      </button>

      {/* A weekly category inside a daily newsletter is the one case that
          needs its own day; anywhere else the issue schedule already decides
          which issue carries it, so the control would be a lie. */}
      {sendCadence === 'daily' && rule.cadence === 'weekly' ? (
        <span className="flex w-full items-center gap-2.5 pl-0 md:pl-[122px]">
          <label className="text-xs text-faint" htmlFor={`rule-weekday-${index}`}>
            In the issue on
          </label>
          <select
            id={`rule-weekday-${index}`}
            value={rule.cadenceWeekday ?? 1}
            onChange={(e) => onPatch({ cadenceWeekday: Number(e.target.value) })}
            className="select-flat py-[7px]"
          >
            {WEEKDAYS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </span>
      ) : null}

      {/* Collapsed by default: empty is correct almost always, and a field
          every row carries invites a number nobody needed to choose. */}
      <span className="flex w-full items-center gap-2.5 pl-0 md:pl-[122px]">
        {showLookahead ? (
          <>
            <label className="text-xs text-faint" htmlFor={`rule-lookahead-${index}`}>
              Look ahead
            </label>
            <input
              id={`rule-lookahead-${index}`}
              type="number"
              min={1}
              max={90}
              value={rule.lookaheadDays ?? ''}
              placeholder={String(derived)}
              onChange={(e) =>
                onPatch({ lookaheadDays: e.target.value === '' ? null : Number(e.target.value) })
              }
              className="field w-[92px] py-1.5 text-[13px]"
            />
            <span className="text-xs text-faint">
              days — leave empty for {derived}, which this cadence covers already
            </span>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowLookahead(true)}
            className="act act-sm"
            aria-label={`Set how far ahead ${label} looks`}
          >
            Look ahead: {derived} days
          </button>
        )}
      </span>
    </li>
  );
}

/** A checkbox with its label, at the form's own type size. */
function Check({
  id,
  checked,
  disabled,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-2.5 text-[13px] font-semibold ${
        disabled ? 'cursor-default text-faint' : 'cursor-pointer'
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="checkbox"
      />
      {label}
    </label>
  );
}

/**
 * Whether what is on screen is what is stored (GOI-102 §5).
 *
 * The screen used to give no feedback that a dropdown change had persisted,
 * so "did that save?" had no answer short of reloading the page — and the
 * honest answer was usually "no", because changing a control here does not
 * save anything until Schedule is pressed.
 */
function SaveState({
  dirty,
  pending,
  justSaved,
  error,
}: {
  dirty: boolean;
  pending: boolean;
  justSaved: boolean;
  error: string | null;
}) {
  // `whitespace-pre-line`: a rejection can name several fields, one per line
  // (see `readableApiError`), and run together they read as one long sentence.
  if (error) {
    return <p role="alert" className="mt-3 text-sm text-accent whitespace-pre-line">{error}</p>;
  }
  if (pending) return <p role="status" className="mt-3 text-sm text-muted">Saving…</p>;
  if (justSaved) return <p role="status" className="mt-3 text-sm font-bold text-accent">Saved.</p>;
  if (dirty) {
    return (
      <p className="mt-3 text-sm text-faint">
        Changes here are not saved until you press <strong>Schedule newsletter</strong>.
      </p>
    );
  }
  return null;
}

/**
 * How often the brief goes out, as a segmented control (design pack: "WHEN IT
 * GOES OUT").
 *
 * A dropdown hid the choice behind a click and read as a form field among
 * form fields; there are two options and the design gives them both a face,
 * so the current one is legible without opening anything. Drawn as one
 * bordered strip with an ink-filled active segment — the poster system's way
 * of showing selection everywhere else (see the category chips).
 *
 * A radiogroup rather than buttons with `aria-pressed`: this is one choice
 * among mutually exclusive options, which is what a radio group means, and it
 * gets arrow-key navigation from the platform for free.
 */
function ScheduleToggle({
  value,
  onChange,
}: {
  value: NewsletterSendCadence;
  onChange: (v: NewsletterSendCadence) => void;
}) {
  // All three since GOI-100. Monthly used to be withheld here on the grounds
  // that it meant eleven silent months — which it did, while a category's own
  // cadence was the only thing deciding what an issue contained. Now that the
  // envelope and the contents are separate, a monthly issue is an ordinary
  // choice: it carries every category that has anything to say, once a month.
  const options: { value: NewsletterSendCadence; label: string }[] = [
    { value: 'daily', label: 'Every day' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ];
  return (
    <div role="radiogroup" aria-label="How often" className="flex border-2 border-ink">
      {options.map((o, i) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`cursor-pointer px-4 py-[9px] text-xs font-extrabold uppercase tracking-[0.5px] ${
              i < options.length - 1 ? 'border-r-2 border-ink' : ''
            } ${active ? 'bg-ink text-white' : 'bg-transparent text-ink hover:text-accent'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One block of the form, in the two shapes the design pack asks for.
 *
 * Desktop is a plain flush-left label with a light rule above it, so the whole
 * form reads as one continuous sheet. The label is `.label-form` (14px) rather
 * than the 11px `.label-caps` used elsewhere: these sections sit beside 22px
 * Anton readouts, and at caption size they read as annotations on the controls
 * instead of as the headings of the sections they open. Below `md` the label becomes a numbered
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
        <span className="hidden md:block label-form">{label}</span>
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
  pdf,
  count,
  error,
}: {
  html: string | null;
  pdf: { filename: string; base64: string } | null;
  count: number | null;
  error: string | null;
}) {
  if (error) {
    return (
      <p role="alert" className="mt-6 text-sm text-accent whitespace-pre-line">
        Couldn&rsquo;t generate a preview.{'\n'}{error}
      </p>
    );
  }
  if (html === null) return null;
  return (
    <div className="mt-10">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3.5">
        <h3 className="label-form">
          Preview{count !== null ? ` — ${count} event${count === 1 ? '' : 's'}` : ''}
        </h3>
        {/* Generating already saved the PDF; these are for when it got lost
            in the downloads folder, or the .html version is wanted instead. */}
        <div className="flex gap-3.5">
          {pdf ? (
            <button type="button" onClick={() => downloadPdf(pdf)} className="act act-sm">
              Download PDF
            </button>
          ) : null}
          <button type="button" onClick={() => downloadBrief(html)} className="act act-sm">
            Download .html
          </button>
        </div>
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
function downloadPdf(pdf: { filename: string; base64: string }): void {
  downloadBase64(pdf.filename, pdf.base64, 'application/pdf');
}

/**
 * Filing every brief on a cloud drive (GOI-91).
 *
 * Sits below the form rather than inside it: connecting is not part of the
 * subscription being edited, and a half-filled form must not be lost to an
 * OAuth redirect. Nothing here is submitted with the rest of the settings.
 */
function DriveCard() {
  const utils = trpc.useUtils();
  const status = trpc.my.newsletter.drive.status.useQuery();
  const [error, setError] = useState<string | null>(null);

  // The callback comes back as a top-level redirect, so its result arrives in
  // the fragment rather than as a mutation response.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const outcome = hash.get('drive');
    if (!outcome) return;
    if (outcome === 'error') setError(hash.get('message') || 'Connecting the drive failed.');
    if (outcome === 'connected') void utils.my.newsletter.drive.status.invalidate();
    // Clear it so a refresh doesn't replay the banner.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [utils]);

  const connect = trpc.my.newsletter.drive.connectUrl.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (e) => setError(e.message),
  });

  const disconnect = trpc.my.newsletter.drive.disconnect.useMutation({
    onSuccess: async () => {
      await utils.my.newsletter.drive.status.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  if (status.isLoading || !status.data) return null;

  // Nothing to offer on a deployment with no Google credentials — say so
  // rather than showing a button that can only fail.
  if (!status.data.available) {
    return (
      <div className="mt-10 border-t-3 border-ink pt-6">
        <h3 className="label-form">Save briefs to a drive</h3>
        <p className="mt-2 text-sm text-muted">
          Not available on this deployment — Google isn&rsquo;t configured.
        </p>
      </div>
    );
  }

  const google = status.data.connections.find((c) => c.provider === 'google') ?? null;

  return (
    <div className="mt-10 border-t-3 border-ink pt-6">
      <h3 className="label-form">Save briefs to a drive</h3>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Connect a drive and each brief can be filed there as a PDF, on its own schedule, in a
        folder of your choosing at the root of the drive. Whether that happens instead of the
        email or as well as it is the choice at the top of this page. AFISZ can only see files
        it puts there itself — nothing else in your drive.
      </p>

      {google ? (
        <div className="mt-4 border-3 border-ink p-4">
          <p className="text-sm font-bold">
            Google Drive connected{google.accountEmail ? ` — ${google.accountEmail}` : ''}
          </p>
          <p className="mt-1 text-sm text-muted">
            {google.lastUploadAt
              ? `Last brief filed ${new Date(google.lastUploadAt).toLocaleDateString()}`
              : 'No brief filed yet'}
          </p>
          <FolderNameField current={google.folderName} />
          {google.lastError ? (
            <p className="mt-2 text-sm text-accent">
              Last upload failed: {google.lastError}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3.5">
            <button
              type="button"
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
              className="act act-sm"
            >
              Reconnect
            </button>
            <button
              type="button"
              onClick={() => disconnect.mutate({ provider: 'google' })}
              disabled={disconnect.isPending}
              className="act act-sm"
            >
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => connect.mutate()}
          disabled={connect.isPending}
          className="btn-outline mt-4 text-center"
        >
          {connect.isPending ? 'Opening Google…' : 'Connect Google Drive'}
        </button>
      )}

      {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
    </div>
  );
}

/**
 * The name of the drive folder briefs land in, as an editable field.
 *
 * Saving renames the folder in the drive rather than pointing at a new one, so
 * briefs already filed stay with the ones still to come (see
 * `renameDriveFolder` on the backend). Kept out of the settings form above on
 * purpose: that form schedules the newsletter, and a folder rename is a write
 * against Google that should not ride along with it.
 */
function FolderNameField({ current }: { current: string }) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState(current);
  const [note, setNote] = useState<string | null>(null);

  // The server is the source of truth: once a rename lands, the draft follows
  // it rather than sitting there looking unsaved.
  useEffect(() => {
    setDraft(current);
  }, [current]);

  const rename = trpc.my.newsletter.drive.setFolderName.useMutation({
    onSuccess: async (res) => {
      setNote(
        res.recreated
          ? 'Saved — the folder is created with the next brief.'
          : 'Renamed in your drive.',
      );
      await utils.my.newsletter.drive.status.invalidate();
    },
    onError: () => setNote(null),
  });

  const trimmed = draft.trim();
  const dirty = trimmed !== current;

  return (
    <form
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty || !trimmed) return;
        setNote(null);
        rename.mutate({ provider: 'google', folderName: trimmed });
      }}
    >
      <label className="label-form mb-1.5" htmlFor="drive-folder">
        Folder
      </label>
      <div className="flex flex-wrap items-start gap-3.5">
        <input
          id="drive-folder"
          type="text"
          value={draft}
          maxLength={MAX_DRIVE_FOLDER_NAME}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={DEFAULT_DRIVE_FOLDER}
          className="field max-w-[16rem]"
        />
        <button
          type="submit"
          disabled={!dirty || !trimmed || rename.isPending}
          className="act act-sm"
        >
          {rename.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {rename.error ? (
        <p className="mt-2 text-sm text-accent">{rename.error.message}</p>
      ) : note ? (
        <p className="mt-2 text-sm text-muted">{note}</p>
      ) : null}
    </form>
  );
}

function downloadBrief(html: string): void {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  downloadText(`afisz-brief-${day}.html`, html, 'text/html');
}

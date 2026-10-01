import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_DRIVE_FOLDER, MAX_DRIVE_FOLDER_NAME } from '@afisz/shared';
import type {
  NewsletterCategoryRule, NewsletterDelivery, NewsletterDetail, NewsletterGroupBy,
  NewsletterRuleCadence, NewsletterSendCadence, NewsletterSettings, NewsletterTimeFilter,
  NewsletterWantToGo,
} from '@afisz/shared';
import {
  allowedRuleCadences, byVenueOrder, DEFAULT_WANT_TO_GO, deliversByEmail, deliversToDrive,
  deriveWindow,
} from '@afisz/shared';
import { trpc } from '../lib/trpc';
import { newsletterApiIsStale, OLDER_API, readableApiError } from '../lib/api-error';
import { downloadBase64, downloadText } from '../lib/download';
import { categoryOrTagLabel, pad, plural } from '../lib/format';

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
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
  { value: 1, label: 'Poniedziałek' },
  { value: 2, label: 'Wtorek' },
  { value: 3, label: 'Środa' },
  { value: 4, label: 'Czwartek' },
  { value: 5, label: 'Piątek' },
  { value: 6, label: 'Sobota' },
  { value: 0, label: 'Niedziela' },
];

/** 1-28. Capped so a monthly newsletter has an issue in February too. */
const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => i + 1);

/**
 * The `IN ISSUES` column's options (GOI-102 §2), worded relative to the send
 * schedule rather than absolutely. "Daily" inside a weekly newsletter was a
 * promise the sender could not keep.
 */
const RULE_CADENCES: { value: NewsletterRuleCadence; label: string }[] = [
  { value: 'every_issue', label: 'W każdym wydaniu' },
  { value: 'weekly', label: 'Raz w tygodniu' },
  { value: 'monthly', label: 'Raz w miesiącu' },
];

/** "1.", "2.", "23." — for the day-of-month picker; Polish writes an
 *  ordinal as the number and a full stop. */
function ordinal(n: number): string {
  return `${n}.`;
}

/** The newsletter's rhythm as an adjective, for sentences about it. */
const CADENCE_ADJECTIVE: Record<NewsletterSendCadence, string> = {
  daily: 'codzienny',
  weekly: 'cotygodniowy',
  monthly: 'comiesięczny',
};

/** How many days a rule's section will cover, given the envelope carrying it
 *  — the number the days field shows as its placeholder. */
function deriveWindowDays(
  sendCadence: NewsletterSendCadence,
  rule: Pick<NewsletterCategoryRule, 'cadence' | 'lookaheadDays'>,
): number {
  const { from, to } = deriveWindow({ sendCadence }, { ...rule, lookaheadDays: null }, new Date());
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** How long the form waits after the last change before autosaving (GOI-142):
 *  long enough not to save every keystroke of a name, short enough that
 *  leaving the page straight after a change rarely loses it. */
const AUTOSAVE_DELAY_MS = 800;

/** "1 day" / "7 days". */
function daysPhrase(n: number): string {
  return `${n} ${plural(n, 'dzień', 'dni', 'dni')}`;
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
  /**
   * Which newsletter the form is editing (GOI-126). A reader may hold several
   * — a daily one for cinema, a weekly one for the rest — so the form edits
   * one at a time, picked from the list above it. Null follows the reader's
   * first newsletter, which is the only one anybody had before this; `NEW`
   * is one that has not been saved yet.
   */
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * Bumped when the reader picks another newsletter, and only then. Saving a
   * new one also moves `selected` to its fresh id, but that is the same form
   * carrying on — remounting it would drop the "Saved." it just earned.
   */
  const [formKey, setFormKey] = useState(0);
  const pick = (next: string | null) => {
    setSelected(next);
    setFormKey((k) => k + 1);
  };
  const utils = trpc.useUtils();
  const list = trpc.my.newsletter.list.useQuery();
  const creating = selected === NEW;
  const id = creating ? null : selected ?? list.data?.[0]?.id ?? null;
  // Still read through `get`, by id, rather than off the list: `get` is the
  // call whose shape says whether the API predates this page (GOI-105).
  const settings = trpc.my.newsletter.get.useQuery(id ? { id } : undefined, {
    enabled: !creating && !list.isLoading,
  });
  // Straight from "My venues" — same source, same folders, same tags — so the
  // brief can only ever cover venues you actually follow.
  const venues = trpc.my.venues.listAll.useQuery();
  const folders = trpc.my.lists.list.useQuery();

  if (list.isLoading || settings.isLoading || venues.isLoading) {
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
          message="Nie udało się wczytać ustawień newslettera."
          onRetry={() => { void settings.refetch(); void venues.refetch(); }}
        />
      </section>
    );
  }
  const saved = creating ? null : settings.data ?? null;
  const newsletters = list.data ?? [];
  return (
    <NewsletterForm
      // A different newsletter is a different form: every field starts again
      // from what that one has stored.
      key={formKey}
      defaultEmail={defaultEmail}
      saved={saved}
      staleApi={newsletterApiIsStale(settings.data)}
      venues={venues.data ?? []}
      folders={folders.data ?? []}
      onCreated={(created) => {
        // Seeded so the switch to its id finds it in hand, not a skeleton.
        utils.my.newsletter.get.setData({ id: created.id }, created);
        setSelected(created.id);
      }}
      onDeleted={() => pick(null)}
      picker={
        newsletters.length > 0 || creating ? (
          <NewsletterPicker
            newsletters={newsletters}
            current={creating ? NEW : saved?.id ?? null}
            onPick={pick}
          />
        ) : null
      }
    />
  );
}

/** The `selected` value of a newsletter that has not been saved yet. */
const NEW = 'new';

/**
 * The reader's newsletters, as a row of folders to open one at a time
 * (GOI-126).
 *
 * Shown only once there is something to choose between: a reader with no
 * newsletter yet, or with just the one, is looking at the only form there is,
 * and a picker holding a single entry would be a heading with a border round
 * it. "New newsletter" is what makes a second one — which is the whole point
 * of the row existing.
 */
export function NewsletterPicker({
  newsletters,
  current,
  onPick,
}: {
  newsletters: Pick<NewsletterSettings, 'id' | 'name' | 'sendCadence' | 'enabled'>[];
  /** Id being edited, `NEW` for an unsaved one. */
  current: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <nav aria-label="Twoje newslettery" className="mb-6 flex flex-wrap gap-2.5">
      {newsletters.map((n) => {
        const active = n.id === current;
        return (
          <button
            key={n.id}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(n.id)}
            className={`cursor-pointer border-2 border-ink px-4 py-2.5 text-left ${
              active ? 'bg-ink text-white' : 'bg-transparent text-ink hover:text-accent'
            }`}
          >
            <span className="block text-[13px] font-extrabold uppercase tracking-[0.5px]">{n.name}</span>
            <span className={`block text-[11px] font-semibold ${active ? 'text-white/75' : 'text-faint'}`}>
              {CADENCE_LABEL[n.sendCadence]}
              {n.enabled ? '' : ' · wstrzymany'}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={current === NEW}
        onClick={() => onPick(NEW)}
        className={`cursor-pointer border-2 border-dashed border-ink px-4 py-2.5 text-[13px] font-extrabold uppercase tracking-[0.5px] ${
          current === NEW ? 'bg-ink text-white' : 'bg-transparent text-ink hover:text-accent'
        }`}
      >
        + Nowy newsletter
      </button>
    </nav>
  );
}

const CADENCE_LABEL: Record<NewsletterSendCadence, string> = {
  daily: 'Codziennie',
  weekly: 'Co tydzień',
  monthly: 'Co miesiąc',
};

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
      <p className="label-form text-accent">Newsletter jest teraz niedostępny</p>
      <p className="mt-2 max-w-prose text-sm font-semibold">
        Zapisywanie i generowanie nie zadziałają: {OLDER_API} Do tego czasu poniższe ustawienia
        są pokazane tak, jak odczytuje je ta strona, i mogą nie zgadzać się z zapisanymi.
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
  picker,
  onCreated,
  onDeleted,
}: {
  defaultEmail: string;
  saved: NewsletterSettings | null;
  /** The API that served `saved` predates this build — see `StaleApiBanner`. */
  staleApi: boolean;
  venues: PickableVenue[];
  folders: { id: string; name: string }[];
  /** The row of the reader's newsletters, when there is one (GOI-126). */
  picker?: React.ReactNode;
  /** A newsletter that did not exist has been saved; this is it. */
  onCreated?: (created: NewsletterSettings) => void;
  onDeleted?: () => void;
}) {
  const [name, setName] = useState(saved?.name ?? (picker ? 'Nowy newsletter' : 'Newsletter'));
  const [email, setEmail] = useState(saved?.email ?? defaultEmail);
  const [recipientName, setRecipientName] = useState(saved?.recipientName ?? '');
  const [delivery, setDelivery] = useState<NewsletterDelivery>(saved?.delivery ?? 'email');
  const [sendCadence, setSendCadenceRaw] = useState<NewsletterSendCadence>(saved?.sendCadence ?? 'weekly');
  const [sendHour, setSendHour] = useState(saved?.sendHour ?? 8);
  const [sendMinute, setSendMinute] = useState(saved?.sendMinute ?? 0);
  const [sendWeekday, setSendWeekday] = useState(saved?.sendWeekday ?? 1);
  const [sendDayOfMonth, setSendDayOfMonth] = useState(saved?.sendDayOfMonth ?? 1);
  const [venueIds, setVenueIds] = useState<string[]>(saved?.venueIds ?? []);
  const [groupBy, setGroupBy] = useState<NewsletterGroupBy>(saved?.groupBy ?? 'event');
  const [venueOrder, setVenueOrder] = useState<string[]>(saved?.venueOrder ?? []);
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
    // A newsletter made beside another starts without your saved events
    // (GOI-126): each newsletter carries them, and their change alerts, on
    // its own, so leaving it on would announce every one of them twice.
    enabled: saved?.wantToGo?.enabled ?? (picker ? false : DEFAULT_WANT_TO_GO.enabled),
  });
  const [enabled, setEnabled] = useState(saved?.enabled ?? true);
  const [justSaved, setJustSaved] = useState(false);
  /** What changing the send cadence did to the rules, shown once (GOI-102). */
  const [reconciled, setReconciled] = useState<string[]>([]);

  /** Venues grouped under their folder, mirroring the "My venues" tab — each
   *  folder in the reader's own order (GOI-140). */
  const byFolder = useMemo(() => {
    const ordered = byVenueOrder(venues, (v) => v.id, venueOrder);
    const groups = folders.map((f) => ({
      id: f.id as string | null,
      name: f.name,
      venues: ordered.filter((v) => v.listId === f.id),
    }));
    const unfiled = ordered.filter((v) => !folders.some((f) => f.id === v.listId));
    if (unfiled.length) groups.push({ id: null, name: 'Bez folderu', venues: unfiled });
    return groups.filter((g) => g.venues.length > 0);
  }, [venues, folders, venueOrder]);

  /**
   * Move a venue one place up or down among its folder's venues (GOI-140).
   * The whole order is written out each time, so a venue that was never
   * placed gets a position the moment any venue moves.
   */
  const moveVenue = (folderVenues: PickableVenue[], id: string, by: -1 | 1) => {
    const at = folderVenues.findIndex((v) => v.id === id);
    const other = folderVenues[at + by];
    if (!other) return;
    const all = byFolder.flatMap((f) => f.venues.map((v) => v.id));
    const i = all.indexOf(id);
    const j = all.indexOf(other.id);
    [all[i], all[j]] = [all[j]!, all[i]!];
    setVenueOrder(all);
  };

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
  const refresh = async () => {
    await Promise.all([utils.my.newsletter.get.invalidate(), utils.my.newsletter.list.invalidate()]);
  };
  const saved_ = () => {
    setJustSaved(true);
    setReconciled([]);
  };
  const update = trpc.my.newsletter.save.useMutation({
    onSuccess: async () => { saved_(); await refresh(); },
  });
  /**
   * A newsletter the reader has never saved is *created*, never upserted
   * (GOI-126): "save" without an id writes the reader's default, which for a
   * reader who already has one is somebody else's newsletter — the daily one
   * would be overwritten by the weekly one they were setting up beside it.
   */
  const create = trpc.my.newsletter.create.useMutation({
    onSuccess: async (created) => { saved_(); await refresh(); onCreated?.(created); },
  });
  const remove = trpc.my.newsletter.remove.useMutation({
    onSuccess: async () => { await refresh(); onDeleted?.(); },
  });
  // One status line for "did that save?", whichever of the two did the saving.
  const save = saved ? update : create;
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
    id: saved?.id,
    name: name.trim() || 'Newsletter',
    sendCadence,
    sendHour,
    sendMinute,
    sendWeekday,
    sendDayOfMonth,
    venueIds,
    groupBy,
    venueOrder,
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

  /**
   * Autosave (GOI-142).
   *
   * A newsletter that already exists saves itself a moment after the reader
   * stops changing it — no button between a dropdown and the stored setting.
   * A new one is still created by its button: creating it is what starts the
   * emails, and a form being filled in for the first time should not begin
   * mailing someone the moment its email field happens to look valid.
   *
   * What was last stored is remembered as the payload it came from, so an
   * autosave only fires for a real difference, and a payload the server just
   * refused is not re-sent in a loop — the next edit is.
   */
  const bodyKey = JSON.stringify(body);
  const storedKey = useRef<string | null>(saved ? bodyKey : null);
  const refusedKey = useRef<string | null>(null);
  const pendingRef = useRef(false);
  pendingRef.current = save.isPending;
  const sendSave = () => {
    const sent = bodyKey;
    save.mutate(body, {
      onSuccess: () => { storedKey.current = sent; refusedKey.current = null; },
      onError: () => { refusedKey.current = sent; },
    });
  };
  const autosaves = !!saved && !staleApi;
  const latest = useRef(sendSave);
  latest.current = sendSave;
  useEffect(() => {
    if (!autosaves || save.isPending) return;
    if (bodyKey === storedKey.current || bodyKey === refusedKey.current) return;
    if (emptyByConstruction || !/^\S+@\S+\.\S+$/.test(email.trim())) return;
    const t = setTimeout(() => {
      if (!pendingRef.current) latest.current();
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [autosaves, bodyKey, save.isPending, emptyByConstruction, email]);

  return (
    <section>
      {staleApi ? <StaleApiBanner /> : null}
      {/* Two lines, deliberately: the heading says what a brief *can* be
          (GOI-97), and the line under it says what yours currently *is*
          (GOI-30), live, following every edit. The old copy tried to be both
          at once and was an example of neither — a fixed "Kino Muranów …
          every day at 08:00" printed over a form set to 15:00. */}
      <PanelHeading title="Newsletter" blurb={NEWSLETTER_BLURB} rule={false} />
      {picker}
      <p className={`${picker ? '' : '-mt-3 '}mb-5 md:mb-6 max-w-[520px] text-sm md:text-base font-semibold text-ink`}>
        <span className="label-form mr-2 text-faint">Twój</span>
        {summary}
      </p>

      <form
        className="max-w-[640px] border-t-3 border-ink"
        onSubmit={(e) => {
          e.preventDefault();
          if (emptyByConstruction) return;
          sendSave();
        }}
      >
        {/* What tells two newsletters apart in the row above (GOI-126). */}
        <div className="px-5 pt-4 pb-4 md:px-0 md:pt-5 md:pb-5">
          <label className="label-form mb-1.5" htmlFor="newsletter-title">
            Nazwa newslettera
          </label>
          <input
            id="newsletter-title"
            type="text"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="np. Kino codziennie"
            className="field max-w-[20rem]"
          />
        </div>

        <FormSection step={1} label="Dokąd trafia">
          <DeliveryChoice value={delivery} onChange={setDelivery} />

          <div className="mt-5 flex flex-wrap gap-5">
            <div className="flex-1 min-w-[14rem]">
              <label className="label-form mb-1.5" htmlFor="newsletter-email">
                Adres e-mail
              </label>
              <input
                id="newsletter-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ty@przyklad.pl"
                className="field"
              />
            </div>
            <div className="flex-1 min-w-[10rem]">
              <label className="label-form mb-1.5" htmlFor="newsletter-name">
                Twoje imię <span className="font-semibold text-faint">(opcjonalnie)</span>
              </label>
              <input
                id="newsletter-name"
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Imię"
                className="field"
              />
              <p className="mt-1.5 text-xs text-faint">
                Newsletter zaczyna się od Twojego imienia (&bdquo;{recipientName.trim() || '…'} — …&rdquo;) — zostaw puste, żeby je pominąć.
              </p>
            </div>
          </div>

          {/* The address is the account either way, so the field stays — but
              saying it is where the brief arrives would be false for someone
              who chose the drive. */}
          {!deliversByEmail(delivery) ? (
            <p className="mt-3 text-xs text-faint">
              Przy tym ustawieniu nic nie jest wysyłane e-mailem. Adres pozostaje adresem Twojego konta,
              a imię nadal pojawia się na początku PDF.
            </p>
          ) : null}

          {deliversToDrive(delivery) ? <DriveRequiredNote /> : null}
        </FormSection>

        <FormSection
          step={2}
          label="Miejsca z moich miejsc"
          note={
            venueIds.length === 0
              ? 'To miejsca, które obserwujesz, pogrupowane w foldery. Zaznacz te, o których chcesz dostawać informacje; jeśli nic nie zaznaczysz, newsletter obejmie wszystkie. Zaznaczanie zawęża tylko newsletter — Twoje foldery się nie zmieniają.'
              : `Newsletter obejmuje ${venueIds.length} z Twoich miejsc. Zaznaczanie zawęża tylko newsletter: Twoje foldery się nie zmieniają, a odznaczone tu miejsce nadal jest w folderze.`
          }
        >
          {byFolder.map((folder) => (
            <div key={folder.id ?? 'unfiled'} className="mb-4 last:mb-0">
              <p className="mb-2 flex flex-wrap items-baseline gap-2.5">
                <span className="tag">{folder.name}</span>
                {/* GOI-102: adding a venue is the folder's job, not this
                    form's, so the form points at it rather than growing a
                    second way to do it that could disagree. */}
                <a href="/my?tab=venues" className="act act-sm">Dodaj miejsca</a>
              </p>
              {/* A list rather than a wrapping row since GOI-140: "up" and
                  "down" only mean something when the order reads top to
                  bottom. */}
              <ol className="list-none m-0 p-0">
                {folder.venues.map((v, i) => (
                  <li key={v.id} className="flex items-center gap-3 py-1">
                    <label className="flex flex-1 items-center gap-2 text-[13px] font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={venueIds.includes(v.id)}
                        onChange={() => toggleVenue(v.id)}
                        className="checkbox"
                      />
                      {v.name}
                    </label>
                    <button
                      type="button"
                      onClick={() => moveVenue(folder.venues, v.id, -1)}
                      disabled={i === 0}
                      aria-label={`Przesuń ${v.name} w górę`}
                      className="act act-sm disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveVenue(folder.venues, v.id, 1)}
                      disabled={i === folder.venues.length - 1}
                      aria-label={`Przesuń ${v.name} w dół`}
                      className="act act-sm disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {venues.length === 0 ? (
            <span className="text-sm text-muted">Najpierw dodaj miejsca w sekcji &bdquo;Moje miejsca&rdquo;.</span>
          ) : null}

          {/* GOI-141: what the brief lists things under. */}
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <span className="label-caps">Układ</span>
            <GroupByToggle value={groupBy} onChange={setGroupBy} />
            <span className="text-xs text-faint">
              {groupBy === 'venue'
                ? 'Każde miejsce raz, w kolejności powyżej, z tym, co się w nim dzieje.'
                : 'Każde wydarzenie raz, ze wszystkimi miejscami i terminami. Miejsca w kolejności powyżej.'}
            </span>
          </div>
        </FormSection>

        {/* GOI-102 §1. The envelope, stated on its own and before the
            contents: how often an issue arrives is a different question from
            what goes in it, and the two used to be one control. */}
        <FormSection step={3} label="Kiedy" note="Jak często przychodzi wydanie. Co się w nim znajdzie, ustawisz niżej.">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3.5">
            <span className="flex items-center gap-2.5">
              <span className="label-caps">Wysyłka</span>
              <ScheduleToggle value={sendCadence} onChange={setSendCadence} />
            </span>

            {sendCadence === 'weekly' ? (
              <span className="flex items-center gap-2.5">
                <label className="label-caps" htmlFor="newsletter-weekday">Dzień</label>
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
                <label className="label-caps" htmlFor="newsletter-day-of-month">Dzień</label>
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
              <span className="label-caps">O</span>
              <span className="inline-flex items-stretch border-2 border-ink bg-white">
                <span className="flex items-center border-r-2 border-ink px-2.5">
                  <ClockIcon />
                </span>
                <label className="sr-only" htmlFor="newsletter-send-hour">Godzina</label>
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
                <label className="sr-only" htmlFor="newsletter-send-minute">Minuta</label>
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
            Czas warszawski — kolejne wydanie o {pad(sendHour)}:{pad(sendMinute)}
            {sendCadence === 'weekly' ? `, dzień: ${WEEKDAYS.find((d) => d.value === sendWeekday)?.label.toLowerCase()}` : null}
            {sendCadence === 'monthly' ? `, ${ordinal(sendDayOfMonth)} dnia miesiąca` : null}
            {sendCadence === 'daily' ? ', codziennie' : null}.
          </p>
        </FormSection>

        <FormSection
          step={4}
          label="Co się w nim znajdzie, według kategorii"
          note="Kategoria to nagłówek w newsletterze. Pochodzi z Twoich miejsc — z ich rodzaju (kino, teatr, muzea) i z tagów, które im nadasz. Każda ma własny rytm, szczegółowość i porę dnia: kino w każdym wydaniu w skrócie, muzea raz w miesiącu z pełnym opisem. Kategorie bez reguły się nie pojawiają."
        >
          {/* Named rather than silent: the reader chose those values, and a
              form that rewrites a choice without saying so is one they stop
              trusting (GOI-102). */}
          {reconciled.length > 0 ? (
            <p role="status" className="mb-3 border-l-3 border-accent pl-3 text-xs text-body">
              {reconciled.join(', ')}: zmieniono na <strong>w każdym wydaniu</strong> —{' '}
              {CADENCE_ADJECTIVE[sendCadence]} newsletter nie może zawierać kategorii częściej, niż sam przychodzi.
            </p>
          ) : null}

          {rules.length > 0 ? (
            <>
              {/* Column headings, desktop only: the rows stack below `md`, where
                  a five-column header would label nothing. */}
              <div className="hidden md:flex gap-3 label-form border-b-2 border-ink pb-2">
                <span className="w-[110px] shrink-0">Kategoria</span>
                <span className="w-[130px] shrink-0">W wydaniach</span>
                <span className="w-[120px] shrink-0">Pora</span>
                <span className="flex-1">Szczegółowość</span>
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
              Ten newsletter byłby zawsze pusty. Dodaj kategorię albo włącz niżej zapisane wydarzenia.
            </p>
          ) : null}

          {allCategories.length === 0 ? (
            <p className="text-sm text-muted">
              Kategorie pochodzą z Twoich miejsc i z nadanych im tagów — najpierw dodaj miejsce
              w sekcji &bdquo;Moje miejsca&rdquo;.
            </p>
          ) : unusedCategories.length > 0 ? (
            <>
              <label className="sr-only" htmlFor="add-rule">Dodaj kategorię</label>
              <select
                id="add-rule"
                value=""
                onChange={(e) => { if (e.target.value) addRule(e.target.value); }}
                className="select-chevron border-0 bg-transparent py-3 pl-0 pr-6 text-xs font-bold uppercase tracking-[0.5px] text-accent"
              >
                <option value="">+ Dodaj kategorię…</option>
                {unusedCategories.map((c) => (
                  <option key={c} value={c}>{categoryOrTagLabel(c)}</option>
                ))}
              </select>
            </>
          ) : (
            <p className="text-sm text-muted">Każda kategoria ma już regułę.</p>
          )}
        </FormSection>

        {/* GOI-102 §3 / GOI-101. Not a category, and deliberately not in the
            table above: this is a queue of events the reader already chose,
            escalating as they approach, and it inherits no cadence, depth or
            window from anything. */}
        <FormSection step={5} label="Zapisane wydarzenia">
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
            Zapisane wydarzenia pojawiają się na początku każdego wydania, z przypomnieniem dzień
            wcześniej i ostrzeżeniem o ostatniej szansie. Dajemy znać, gdy coś zostanie odwołane lub przeniesione.
          </p>

          <Check
            id="wtg-enabled"
            checked={wantToGo.enabled}
            onChange={(v) => setWantToGo((w) => ({ ...w, enabled: v }))}
            label="Dołącz zapisane wydarzenia"
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
            {enabled ? '● Newsletter włączony' : 'Włącz newsletter'}
          </button>
          <div className="flex w-full flex-col md:w-auto md:flex-row gap-3.5">
            <button
              type="submit"
              disabled={save.isPending || emptyByConstruction}
              className="btn-outline text-center"
            >
              {save.isPending ? 'Zapisywanie…' : 'Zaplanuj newsletter'}
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
              {preview.isPending ? 'Generowanie…' : 'Wygeneruj teraz'}
            </button>
          </div>
          {/* Only a saved newsletter has anything to delete; an unsaved one
              is abandoned by picking another (GOI-126). */}
          {saved ? (
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Usunąć „${saved.name}”? Nic więcej z niego nie zostanie wysłane.`)) {
                  remove.mutate({ id: saved.id });
                }
              }}
              className="bg-transparent border-0 p-0 cursor-pointer text-xs font-bold uppercase tracking-[0.5px] text-muted hover:text-accent"
            >
              {remove.isPending ? 'Usuwanie…' : 'Usuń ten newsletter'}
            </button>
          ) : null}
          {remove.error ? (
            <p role="alert" className="text-xs font-semibold text-accent">
              {readableApiError(remove.error.message)}
            </p>
          ) : null}
        </div>

        {/* GOI-102 §5: the screen used to give no sign that a dropdown change
            had persisted, so "did that save?" had no answer but reloading. */}
        <SaveState
          dirty={!justSaved && (save.isIdle || save.isSuccess) && bodyKey !== storedKey.current}
          autosaves={autosaves}
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
    { value: 'email', label: 'E-mail', hint: 'Newsletter trafia do Twojej skrzynki.' },
    { value: 'drive', label: 'Dysk', hint: 'Zapisywany jako PDF. Nic nie jest wysyłane e-mailem.' },
    { value: 'both', label: 'Oba', hint: 'Wysyłany e-mailem i dodatkowo zapisywany jako PDF.' },
  ];
  const current = options.find((o) => o.value === value);

  return (
    <div>
      {/*
        Three buttons of one size (GOI-115).
        They were sized by their own labels, so "Email", "Drive" and "Both"
        came out three different widths — which reads as three options of
        different weight, when they are one choice of three equal answers. A
        three-column grid gives each the same cell whatever its label is, and
        `w-full` on the buttons is what makes them fill it rather than sit
        centred in it.
      */}
      <div
        role="radiogroup"
        aria-label="Jak go wysyłać"
        className="grid grid-cols-3 border-2 border-ink max-w-[420px]"
      >
        {options.map((o, i) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={`w-full cursor-pointer px-4 py-[9px] text-center text-xs font-extrabold uppercase tracking-[0.5px] ${
                i < options.length - 1 ? 'border-r-2 border-ink' : ''
              } ${active ? 'bg-ink text-white' : 'bg-transparent text-ink hover:text-accent'}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {/* One line under the row rather than three inside it: the hint answers
          "what did I just pick", which only the chosen one has to say. */}
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
          W tej instalacji dyski nie są dostępne, więc nic nie zostanie zapisane. Wybierz
          &bdquo;E-mail&rdquo;.
        </Note>
      );
    }
    if (status.data.connections.length === 0) {
      return (
        <Note alert>
          Nie połączono jeszcze żadnego dysku, więc nie ma gdzie zapisać PDF — połącz go niżej, w sekcji
          &bdquo;Zapisuj newslettery na dysku&rdquo;. Do tego czasu nic nie zostanie zapisane.
        </Note>
      );
    }
    return null;
  }

  // Status unknown. Not an alarm — it may simply not have arrived yet — but
  // not nothing either.
  return (
    <Note>
      Newslettery trafiają na dysk połączony niżej, w sekcji &bdquo;Zapisuj newslettery na dysku&rdquo;.
      Bez połączonego dysku nic nie jest zapisywane.
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
  const why = `${capitalise(CADENCE_ADJECTIVE[sendCadence])} newsletter nie może zawierać kategorii częściej, niż sam przychodzi.`;

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 rule-soft text-[13px]">
      {/* Caps at the dropdowns' own size and weight — the row is one line of
          type, and a sentence-case name beside caps selects broke it. */}
      <span className="md:w-[110px] md:shrink-0 text-xs font-extrabold uppercase tracking-[0.5px]">
        {label}
      </span>

      <label className="sr-only" htmlFor={`rule-cadence-${index}`}>Jak często: {label}</label>
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

      <label className="sr-only" htmlFor={`rule-time-${index}`}>Pora dnia: {label}</label>
      <select
        id={`rule-time-${index}`}
        value={rule.timeFilter}
        onChange={(e) => onPatch({ timeFilter: e.target.value as NewsletterTimeFilter })}
        className="select-flat md:w-[120px] md:shrink-0"
      >
        <option value="any">Każda pora</option>
        <option value="after_17">Po 17:00</option>
        <option value="after_18">Po 18:00</option>
        <option value="after_19">Po 19:00</option>
        <option value="after_20">Po 20:00</option>
      </select>

      <label className="sr-only" htmlFor={`rule-detail-${index}`}>Opis: {label}</label>
      <select
        id={`rule-detail-${index}`}
        value={rule.detail}
        onChange={(e) => onPatch({ detail: e.target.value as NewsletterDetail })}
        className="select-flat md:flex-1"
      >
        <option value="line">Jedna linijka</option>
        <option value="short">Krótki opis</option>
        <option value="full">Pełny opis</option>
      </select>

      <button
        type="button"
        aria-label={`Usuń ${label}`}
        onClick={onRemove}
        className="act act-sm ml-auto md:w-[54px] md:shrink-0 md:text-left"
      >
        Usuń
      </button>

      {/* A weekly category inside a daily newsletter is the one case that
          needs its own day; anywhere else the issue schedule already decides
          which issue carries it, so the control would be a lie. */}
      {sendCadence === 'daily' && rule.cadence === 'weekly' ? (
        <span className="flex w-full items-center gap-2.5 pl-0 md:pl-[122px]">
          <label className="text-xs text-faint" htmlFor={`rule-weekday-${index}`}>
            W wydaniu w dniu
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
          every row carries invites a number nobody needed to choose.
          One plain sentence either way (GOI-119, GOI-137): "Look ahead" and a
          paragraph about spans and repeats was read as not understandable, so
          the field sits inside the sentence it answers. */}
      <span className="flex w-full flex-wrap items-center gap-2 pl-0 md:pl-[122px] text-xs text-faint">
        {showLookahead ? (
          <>
            <label htmlFor={`rule-lookahead-${index}`}>Każde wydanie pokazuje najbliższe</label>
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
              className="field w-[72px] py-1.5 text-[13px]"
            />
            <span>{plural(Number(rule.lookaheadDays ?? derived), 'dzień', 'dni', 'dni')} programu ({label.toLowerCase()}).</span>
          </>
        ) : (
          <>
            <span>
              Każde wydanie pokazuje najbliższe {daysPhrase(derived)} programu ({label.toLowerCase()}).
            </span>
            <button
              type="button"
              onClick={() => setShowLookahead(true)}
              className="act act-sm"
              aria-label={`Zmień, ile dni programu (${label}) pokazuje każde wydanie`}
            >
              Zmień
            </button>
          </>
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
  autosaves,
  pending,
  justSaved,
  error,
}: {
  dirty: boolean;
  /** Changes save themselves (GOI-142) — only a new newsletter waits for the
   *  button. */
  autosaves: boolean;
  pending: boolean;
  justSaved: boolean;
  error: string | null;
}) {
  // `whitespace-pre-line`: a rejection can name several fields, one per line
  // (see `readableApiError`), and run together they read as one long sentence.
  if (error) {
    return <p role="alert" className="mt-3 text-sm text-accent whitespace-pre-line">{error}</p>;
  }
  if (pending) return <p role="status" className="mt-3 text-sm text-muted">Zapisywanie…</p>;
  if (justSaved) return <p role="status" className="mt-3 text-sm font-bold text-accent">Zapisano.</p>;
  if (autosaves) {
    return <p className="mt-3 text-sm text-faint">Zmiany zapisują się automatycznie.</p>;
  }
  if (dirty) {
    return (
      <p className="mt-3 text-sm text-faint">
        Nic nie zostanie wysłane, dopóki nie klikniesz <strong>Zaplanuj newsletter</strong>. Potem
        zmiany zapisują się automatycznie.
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
/** Event-first or venue-first (GOI-141), drawn like the schedule toggle. */
function GroupByToggle({
  value,
  onChange,
}: {
  value: NewsletterGroupBy;
  onChange: (v: NewsletterGroupBy) => void;
}) {
  const options: { value: NewsletterGroupBy; label: string }[] = [
    { value: 'event', label: 'Według wydarzeń' },
    { value: 'venue', label: 'Według miejsc' },
  ];
  return (
    <div role="radiogroup" aria-label="Układ" className="flex border-2 border-ink">
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
    { value: 'daily', label: 'Codziennie' },
    { value: 'weekly', label: 'Co tydzień' },
    { value: 'monthly', label: 'Co miesiąc' },
  ];
  return (
    <div role="radiogroup" aria-label="Jak często" className="flex border-2 border-ink">
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
        Nie udało się wygenerować podglądu.{'\n'}{error}
      </p>
    );
  }
  if (html === null) return null;
  return (
    <div className="mt-10">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3.5">
        <h3 className="label-form">
          Podgląd{count !== null ? ` — ${count} ${plural(count, 'wydarzenie', 'wydarzenia', 'wydarzeń')}` : ''}
        </h3>
        {/* Generating already saved the PDF; these are for when it got lost
            in the downloads folder, or the .html version is wanted instead. */}
        <div className="flex gap-3.5">
          {pdf ? (
            <button type="button" onClick={() => downloadPdf(pdf)} className="act act-sm">
              Pobierz PDF
            </button>
          ) : null}
          <button type="button" onClick={() => downloadBrief(html)} className="act act-sm">
            Pobierz .html
          </button>
        </div>
      </div>
      <iframe
        data-testid="newsletter-preview"
        title="Podgląd newslettera"
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
    if (outcome === 'error') setError(hash.get('message') || 'Nie udało się połączyć dysku.');
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
        <h3 className="label-form">Zapisuj newslettery na dysku</h3>
        <p className="mt-2 text-sm text-muted">
          Niedostępne w tej instalacji — Google nie jest skonfigurowany.
        </p>
      </div>
    );
  }

  const google = status.data.connections.find((c) => c.provider === 'google') ?? null;

  return (
    <div className="mt-10 border-t-3 border-ink pt-6">
      <h3 className="label-form">Zapisuj newslettery na dysku</h3>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Połącz dysk, a każdy newsletter może trafiać tam jako PDF, zgodnie z harmonogramem, do
        wybranego folderu w głównym katalogu dysku. Czy zamiast e-maila, czy obok niego — to wybór
        na górze tej strony. AFISZ widzi tylko pliki, które sam tam zapisał — nic więcej
        z Twojego dysku.
      </p>

      {google ? (
        <div className="mt-4 border-3 border-ink p-4">
          <p className="text-sm font-bold">
            Połączono Dysk Google{google.accountEmail ? ` — ${google.accountEmail}` : ''}
          </p>
          <p className="mt-1 text-sm text-muted">
            {google.lastUploadAt
              ? `Ostatni newsletter zapisano ${new Date(google.lastUploadAt).toLocaleDateString('pl-PL')}`
              : 'Nie zapisano jeszcze żadnego newslettera'}
          </p>
          <FolderNameField current={google.folderName} />
          {google.lastError ? (
            <p className="mt-2 text-sm text-accent">
              Ostatnie zapisywanie nie powiodło się: {google.lastError}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3.5">
            <button
              type="button"
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
              className="act act-sm"
            >
              Połącz ponownie
            </button>
            <button
              type="button"
              onClick={() => disconnect.mutate({ provider: 'google' })}
              disabled={disconnect.isPending}
              className="act act-sm"
            >
              {disconnect.isPending ? 'Rozłączanie…' : 'Rozłącz'}
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
          {connect.isPending ? 'Otwieranie Google…' : 'Połącz Dysk Google'}
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
          ? 'Zapisano — folder powstanie przy następnym newsletterze.'
          : 'Zmieniono nazwę na Twoim dysku.',
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
          {rename.isPending ? 'Zapisywanie…' : 'Zapisz'}
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

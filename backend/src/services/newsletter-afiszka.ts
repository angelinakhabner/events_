import { isExhibition } from '@afisz/shared';
import type { Event, Festival, NewsletterDetail, NewsletterFrequency } from '@afisz/shared';
import type { BriefSection } from './newsletter-render.js';
import type { QueuedChange, QueuedEvent, WantToGoSection } from './want-to-go-queue.js';
import { MONTHS, PL, closingDate, daySpan, fmt, plural, time, weekday } from './newsletter-copy.js';

/**
 * The AFISZ.KA newsletter — the "Newsletter presentation redesign" handoff,
 * which a reader can pick instead of the classic brief (`NewsletterDesign`).
 *
 * Not to be confused with `newsletter-poster.ts`: that is the earlier "AFISZ.KA
 * Daily" handoff, which the classic design still draws a daily PDF with. This
 * revision supersedes it for readers who choose it — it adds the weekly and
 * monthly Outlook, the email, and the stricter rules below.
 *
 * This file is the *selection* half of the design handoff: which events go on
 * the front page, which are only referenced from the listing, how a listing
 * section is laid out and how repeat shows read. It is pure — no markup, no
 * pdfkit — so the email (`newsletter-afiszka-html.ts`) and the PDF
 * (`newsletter-afiszka-pdf.ts`) render one model and cannot disagree about
 * what is in an issue, only about how it is drawn.
 *
 * The handoff's rules it implements, in its own priority order:
 *
 * 1. Every entry is identified by title, when, where and (where there is one)
 *    a description.
 * 2. No duplication: an event's full entry appears exactly once per issue. A
 *    pick or a saved event is printed in full on the front page and only as a
 *    one-line reference in the listing; repeat performances are one entry
 *    with all their dates.
 * 3. Picks are few and rule-based — premieres and openings — and an issue
 *    with no candidates has no picks section rather than filler.
 */

const TZ = 'Europe/Warsaw';
const DAY_MS = 86_400_000;

// ─── Labels ──────────────────────────────────────────────────────────────────

/**
 * The issue's own framing words. Polish, like the classic brief's (see `PL`
 * for why), and only framing: titles and descriptions are printed as the
 * venues wrote them.
 */
export const AFISZKA = {
  wordmark: { head: 'AFISZ', tail: 'KA' },
  edition: { daily: 'Dziennik', weekly: 'Tydzień', monthly: 'Miesiąc' } as Record<NewsletterFrequency, string>,
  factWhen: { daily: 'Dziś', weekly: 'Przed Tobą', monthly: 'Przed Tobą' } as Record<NewsletterFrequency, string>,
  factCity: 'Miasto',
  factEvents: 'Wydarzenia',
  factVenues: 'Miejsca',
  dedication: 'wybrane z miejsc, które obserwujesz',
  hero: 'Dziś wieczorem — ten jeden',
  heroDay: 'Dziś — ten jeden',
  morePicks: 'Jeszcze dziś',
  morePicksNote: 'Pełny program dalej',
  contents: 'W tym wydaniu',
  wantToGo: PL.wantToGo,
  wantToGoNote: { daily: 'Zapisane przez Ciebie · dziś', other: 'Zapisane przez Ciebie' },
  closingSoon: 'Ostatnie dni — zdążysz',
  lastDay: 'ostatni dzień',
  festivals: PL.festivals,
  premiere: 'Premiera',
  opens: (date: string) => `Otwarcie ${date}`,
  ends: (date: string) => `Do ${date}`,
  ongoing: 'Trwa',
  allDay: 'Cały dzień',
  morning: 'Rano',
  afternoon: 'Po południu',
  evening: 'Wieczorem',
  week: (n: number) => `Tydzień ${n}`,
  timeline: 'Wystawy',
  sheet: (n: number) => `Arkusz ${n}`,
  sheets: (a: number, b: number) => (a === b ? `Arkusz ${a}` : `Arkusze ${a}–${b}`),
  sheetOf: (n: number, total: number) => `Arkusz ${n} z ${total}`,
  /** Where a referenced entry is printed in full. On paper that is sheet 1;
   *  in an email, which has no sheets, it is simply further up. */
  refPdf: '→ arkusz 1',
  refEmail: '→ wyżej',
  lastPerformance: 'Ostatni raz',
  nothing: PL.nothing,
  count: {
    cinema: (n: number) => `${n} ${plural(n, 'film', 'filmy', 'filmów')}`,
    other: (n: number) => `${n} ${plural(n, 'wydarzenie', 'wydarzenia', 'wydarzeń')}`,
    venues: (n: number) => `${n} ${plural(n, 'miejsce', 'miejsca', 'miejsc')}`,
    premieres: (n: number) => `${n} ${plural(n, 'premiera', 'premiery', 'premier')}`,
    openings: (n: number) => `${n} ${plural(n, 'otwarcie', 'otwarcia', 'otwarć')}`,
    dates: (n: number) => `${n} ${plural(n, 'termin', 'terminy', 'terminów')}`,
  },
} as const;

// ─── Model ───────────────────────────────────────────────────────────────────

/**
 * One show: every occurrence of a title at one venue, merged (handoff §1).
 *
 * The same film at two cinemas stays two entries — those are two places a
 * reader could go — but five performances of one play at one theatre are one
 * entry with five dates, not five rows.
 */
export interface AfiszkaEntry {
  key: string;
  /** Every source row merged into this entry. */
  ids: string[];
  title: string;
  url: string | null;
  /** The section's category, which may be a reader's own tag. */
  category: string;
  venue: string;
  /** The longest description any merged row carried, verbatim. */
  description: string | null;
  exhibition: boolean;
  /** Timed: every start, ascending. Exhibition: just its opening. */
  occurrences: string[];
  /** Exhibition run, or null for a timed entry. */
  run: { opens: string; closes: string | null } | null;
  /** Earliest occurrence; entries sort on this. */
  first: string;
  /** Why it is a pick, or null when it is not a candidate. */
  pick: PickReason | null;
}

export type PickReason = { kind: 'premiere' } | { kind: 'opening'; at: string };

/** A saved event on the front page — one queue row of the classic brief. */
export interface AfiszkaSaved {
  entry: AfiszkaEntry;
  /** The state label ("Jutro", "Odwołane"), or null for a plain reminder. */
  state: string | null;
  /** Red when it is about something going wrong or running out. */
  urgent: boolean;
}

/** One block of a listing section, in the layout that suits its events. */
export type AfiszkaBlock =
  /** Cinema-like: one band per start time, up to three cells a row. */
  | { kind: 'bands'; bands: AfiszkaBand[] }
  /** Daytime and exhibitions: All day, Morning, Afternoon, Evening. */
  | { kind: 'parts'; parts: AfiszkaPart[] }
  /** Several days: one block per week, entries by first occurrence. */
  | { kind: 'weeks'; weeks: AfiszkaWeek[] }
  /** Several days of exhibitions: a run bar over a day grid. */
  | { kind: 'timeline'; days: string[]; rows: AfiszkaEntry[] }
  /** The reader grouped by venue (GOI-141): one block per venue, in their
   *  order, the venue named once in its heading rather than on every entry. */
  | { kind: 'venues'; venues: { name: string; entries: AfiszkaEntry[] }[] };

export interface AfiszkaBand {
  time: string;
  /** "3 filmy", or "5 filmów · 1–3" when a time is split across bands. */
  label: string;
  cells: AfiszkaEntry[];
}

export interface AfiszkaPart {
  label: string;
  /** "13:00–18:00", or null for All day. */
  range: string | null;
  allDay: boolean;
  cells: AfiszkaEntry[];
}

export interface AfiszkaWeek {
  label: string;
  span: string;
  entries: AfiszkaEntry[];
}

export interface AfiszkaSection {
  category: string;
  label: string;
  detail: NewsletterDetail;
  /** "15 seansów", for the caption beside the section heading. */
  count: string;
  /** "19:00 → 22:35" or "8–14 IX", the span the section covers. */
  span: string;
  blocks: AfiszkaBlock[];
  /** Entries in the section, for the contents rows. */
  entries: AfiszkaEntry[];
  /** The section's picks, for the Outlook contents row. */
  picks: AfiszkaEntry[];
  /** "3 premiery", or the section's own count when it has no picks. */
  reason: string;
}

export interface AfiszkaIssue {
  kind: 'daily' | 'outlook';
  issueNo: number | null;
  frequency: NewsletterFrequency;
  now: Date;
  /** Days the issue covers, from the send cadence. */
  days: number;
  name: string | null;
  facts: { label: string; value: string }[];
  dedication: string;
  /** Daily only. */
  hero: AfiszkaEntry | null;
  /** Daily: up to three more picks. */
  morePicks: AfiszkaEntry[];
  saved: AfiszkaSaved[];
  /** Outlook only: exhibitions closing inside the issue, soonest first. */
  closingSoon: AfiszkaEntry[];
  festivals: Festival[];
  sections: AfiszkaSection[];
  /** Ids printed in full on the front page; the listing only refers to them. */
  front: Set<string>;
  empty: boolean;
}

export interface AfiszkaContent {
  sections: BriefSection[];
  /** The config's running issue number, for the masthead; null in a preview. */
  issueNo?: number | null;
  wantToGo?: WantToGoSection;
  fallbackFrequency?: NewsletterFrequency;
  recipientName?: string | null;
  festivals?: Festival[];
  now?: Date;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

const dayKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso));

const hourOf = (iso: string) => Number(fmt(iso, { hour: '2-digit', hour12: false })) % 24;

const minutesOf = (iso: string) => hourOf(iso) * 60 + Number(fmt(iso, { minute: '2-digit' }));

/** `8` — the day of the month, for the big numerals. */
export const dayNumber = (iso: string) => fmt(iso, { day: 'numeric' });

/** `WRZ` — the month, abbreviated as the brief writes it (GOI-147). */
export const monthAbbr = (iso: string) => MONTHS[Number(fmt(iso, { month: 'numeric' })) - 1]!;

/** `PT 4 WRZ` — weekday, day and month. */
export function dayLabel(iso: string): string {
  return `${weekday(iso)} ${dayNumber(iso)} ${monthAbbr(iso)}`;
}

/** `PIĄTEK` / `4 WRZEŚNIA 2026` — the two lines of the daily date cell. */
export function longDay(iso: string): { weekday: string; date: string } {
  return {
    weekday: fmt(iso, { weekday: 'long' }).toUpperCase(),
    date: fmt(iso, { day: 'numeric', month: 'long', year: 'numeric' }),
  };
}

function cadenceDays(frequency: NewsletterFrequency): number {
  return frequency === 'daily' ? 1 : frequency === 'weekly' ? 7 : 30;
}

/** Start of the Warsaw day `iso` falls on, as a Date. */
function startOfDay(at: Date): Date {
  const key = dayKey(at.toISOString());
  // Noon UTC on that calendar day is the same Warsaw day whatever the offset,
  // and stepping whole days from it never crosses a DST edge into the wrong
  // date. Only the date is ever read back off these.
  return new Date(`${key}T12:00:00Z`);
}

function normaliseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The category's name in the issue — Polish for the built-ins, the reader's
 *  own word for a tag. */
export function afiszkaSectionLabel(category: string): string {
  if (!category) return 'Program';
  if (category === 'exhibition') return 'Muzea';
  if (category === 'theatre') return 'Teatr';
  if (category === 'music') return 'Muzyka';
  return PL.categories[category as keyof typeof PL.categories] ?? category;
}

// ─── Descriptions (§2.5) ─────────────────────────────────────────────────────

/**
 * A description at the length the setting asks for.
 *
 * `short`: the first sentence, cut at ~160 characters on a word boundary.
 * `full`: the whole text. `line`: none — the reader asked for a listing of
 * titles. Never rewritten or translated; a missing description is null, and
 * the slot collapses rather than printing a placeholder.
 */
export function describe(text: string | null, detail: NewsletterDetail, max = 160): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat || detail === 'line') return null;
  if (detail === 'full') return flat;
  const sentence = flat.match(/^.+?[.!?…](?=\s|$)/)?.[0] ?? flat;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,.;:—–-]+$/, '');
  return `${atWord}…`;
}

// ─── Dates for repeat shows (§2.6) ───────────────────────────────────────────

/**
 * Every date of an entry as one compact run.
 *
 * `WT 8 · CZW 10 · SB 12, 19:30` when the time is shared, `PT 11 19:00 · PT 18
 * 21:00` when it is not. A run too long to list — a film held over all month —
 * reads as its span and a count, since thirty dates bury the one line of the
 * entry that matters.
 */
export function dateRun(occurrences: string[]): string {
  if (occurrences.length === 0) return '';
  const times = new Set(occurrences.map(time));
  const days = [...new Set(occurrences.map(dayKey))];
  if (days.length === 1) {
    return `${dayLabel(occurrences[0]!)}, ${[...times].join(' · ')}`;
  }
  if (occurrences.length > 6) {
    const span = daySpan(occurrences[0]!, occurrences[occurrences.length - 1]!);
    const tail = times.size === 1 ? `, ${[...times][0]}` : '';
    return `${span} · ${AFISZKA.count.dates(occurrences.length)}${tail}`;
  }
  if (times.size === 1) {
    return `${occurrences.map((o) => `${weekday(o)} ${dayNumber(o)}`).join(' · ')}, ${[...times][0]}`;
  }
  return occurrences.map((o) => `${weekday(o)} ${dayNumber(o)} ${time(o)}`).join(' · ');
}

/** Times on one day: `17:30 · 20:15`. */
export function timesOf(entry: AfiszkaEntry): string {
  return [...new Set(entry.occurrences.map(time))].join(' · ');
}

/**
 * What a listing cell says about when: the run for an exhibition, every date
 * for a show on several days, the times for one on a single day (or nothing,
 * where a time rail beside the cell already says it).
 */
export function entryWhen(entry: AfiszkaEntry, from: Date, days: number, showTime: boolean): string {
  if (entry.exhibition) return runLabel(entry, from, days);
  if (new Set(entry.occurrences.map(dayKey)).size > 1) return dateRun(entry.occurrences);
  if (showTime || entry.occurrences.length > 1) return timesOf(entry);
  return '';
}

/** An exhibition's run, relative to the days the issue shows. */
export function runLabel(entry: AfiszkaEntry, from: Date, days: number): string {
  if (!entry.run) return '';
  const start = startOfDay(from).getTime() - DAY_MS / 2;
  const end = start + days * DAY_MS;
  const opens = new Date(entry.run.opens).getTime();
  const closes = entry.run.closes ? new Date(entry.run.closes).getTime() : null;
  const parts: string[] = [];
  if (opens >= start && opens < end) parts.push(AFISZKA.opens(dayNumber(entry.run.opens)));
  if (closes !== null && closes >= start && closes < end) {
    parts.push(AFISZKA.ends(dayNumber(entry.run.closes!)));
  } else if (closes !== null) {
    parts.push(AFISZKA.ends(`${dayNumber(entry.run.closes!)} ${monthAbbr(entry.run.closes!)}`));
  }
  return parts.length ? parts.join(' · ') : AFISZKA.ongoing;
}

// ─── Picks (§2.4) ────────────────────────────────────────────────────────────

/** Premiere wording, in either language a venue writes it in. */
const PREMIERE = /\b(pra)?premier[aąy]?\b|\bpremiere\b/i;

/**
 * Why an entry is a pick, or null.
 *
 * The one signal confirmed so far is premieres and openings: an exhibition
 * that opens inside the issue, or a show whose own title calls it a premiere.
 * Only the title — a description that mentions a premiere is usually talking
 * about one years ago.
 *
 * The hook the handoff asks for: further signals (closing soon, an editor's
 * choice, the reader's history) belong here and nowhere else.
 */
export function scorePick(
  entry: Pick<AfiszkaEntry, 'exhibition' | 'run' | 'title'>,
  from: Date,
  days: number,
): PickReason | null {
  if (entry.exhibition && entry.run) {
    const start = startOfDay(from).getTime() - DAY_MS / 2;
    const opens = new Date(entry.run.opens).getTime();
    if (opens >= start && opens < start + days * DAY_MS) {
      return { kind: 'opening', at: entry.run.opens };
    }
    return null;
  }
  return PREMIERE.test(entry.title) ? { kind: 'premiere' } : null;
}

export function pickReasonLabel(reason: PickReason): string {
  return reason.kind === 'premiere'
    ? AFISZKA.premiere
    : AFISZKA.opens(`${dayNumber(reason.at)} ${monthAbbr(reason.at)}`);
}

// ─── Building the issue ──────────────────────────────────────────────────────

/** Merge a section's rows into entries: one per title per venue. */
export function buildEntries(section: BriefSection, from: Date, days: number): AfiszkaEntry[] {
  const groups = new Map<string, Event[]>();
  for (const e of section.events) {
    const key = `${normaliseTitle(e.title)}|${e.venueId}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const entries: AfiszkaEntry[] = [];
  for (const [key, group] of groups) {
    entries.push(toEntry(key, group, section.category, from, days));
  }
  return entries.sort(
    (a, b) => a.first.localeCompare(b.first) || a.title.localeCompare(b.title),
  );
}

function toEntry(key: string, group: Event[], category: string, from: Date, days: number): AfiszkaEntry {
  const sorted = [...group].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const lead = sorted[0]!;
  const exhibition = isExhibition(lead);
  // The longest description any copy carried: enrichment is per page, so one
  // performance may have the text another lacks.
  const description = sorted
    .map((e) => e.description?.trim() ?? '')
    .reduce((best, d) => (d.length > best.length ? d : best), '') || null;
  const run = exhibition
    ? {
        opens: lead.startsAt,
        closes: sorted.map((e) => e.endsAt).filter((x): x is string => !!x).sort().pop() ?? null,
      }
    : null;
  const base = {
    key,
    ids: sorted.map((e) => e.id),
    title: lead.title.trim(),
    url: lead.sourceUrl || null,
    category,
    venue: lead.venue?.name ?? '',
    description,
    exhibition,
    occurrences: exhibition ? [lead.startsAt] : [...new Set(sorted.map((e) => e.startsAt))],
    run,
    first: lead.startsAt,
  };
  return { ...base, pick: scorePick(base, from, days) };
}

/** A saved event as a one-row entry, for the front page. */
function savedEntry(event: Event, from: Date, days: number): AfiszkaEntry {
  return toEntry(`saved|${event.id}`, [event], event.category, from, days);
}

function changeLabel(change: QueuedChange): string {
  if (change.type === 'rescheduled') {
    return change.newValue ? PL.rescheduled(time(change.newValue)) : PL.movedVenue;
  }
  if (change.type === 'cancelled') return PL.cancelled;
  if (change.type === 'moved') return PL.movedVenue;
  return PL.soldOut;
}

const STATE_LABEL: Record<QueuedEvent['state'], { label: string; urgent: boolean } | null> = {
  last_chance: { label: PL.lastChance, urgent: true },
  tomorrow: { label: PL.tomorrow, urgent: false },
  this_week: null,
  ongoing: { label: PL.ongoing, urgent: false },
};

/** Want to go (§2.3): changes first — something that happened outranks
 *  something coming — then reminders by first occurrence. */
function buildSaved(queue: WantToGoSection | undefined, from: Date, days: number): AfiszkaSaved[] {
  if (!queue) return [];
  const changes = queue.changes.map((c) => ({
    entry: savedEntry(c.event, from, days),
    state: changeLabel(c),
    urgent: true,
  }));
  const reminders = [...queue.reminders]
    .sort((a, b) => a.event.startsAt.localeCompare(b.event.startsAt))
    .map((r) => {
      const s = STATE_LABEL[r.state] ?? null;
      return { entry: savedEntry(r.event, from, days), state: s?.label ?? null, urgent: s?.urgent ?? false };
    });
  return [...changes, ...reminders];
}

/**
 * Whether most of a section starts inside one short evening window — a
 * cinema's shape, which reads best as one band per start time (§3.3).
 */
export function isTimeBanded(entries: AfiszkaEntry[]): boolean {
  const timed = entries.filter((e) => !e.exhibition);
  if (timed.length < 3) return false;
  const starts = timed.map((e) => minutesOf(e.first)).sort((a, b) => a - b);
  const need = Math.ceil(starts.length * 0.7);
  for (let i = 0; i + need - 1 < starts.length; i++) {
    if (starts[i + need - 1]! - starts[i]! <= 6 * 60) return true;
  }
  return false;
}

/** One band per start time; never more than three cells a band. */
function bands(entries: AfiszkaEntry[], category: string): AfiszkaBand[] {
  const byTime = new Map<string, AfiszkaEntry[]>();
  for (const e of entries) {
    const t = time(e.first);
    const list = byTime.get(t);
    if (list) list.push(e);
    else byTime.set(t, [e]);
  }
  const count = category === 'cinema' ? AFISZKA.count.cinema : AFISZKA.count.other;
  const out: AfiszkaBand[] = [];
  for (const [t, list] of [...byTime].sort(([a], [b]) => a.localeCompare(b))) {
    if (list.length <= 3) {
      out.push({ time: t, label: count(list.length), cells: list });
      continue;
    }
    for (let i = 0; i < list.length; i += 3) {
      const slice = list.slice(i, i + 3);
      const range = slice.length === 1 ? `${i + 1}` : `${i + 1}–${i + slice.length}`;
      out.push({ time: t, label: `${count(list.length)} · ${range}`, cells: slice });
    }
  }
  return out;
}

/** All day, Morning (<13), Afternoon (13–18), Evening (≥18). */
function parts(entries: AfiszkaEntry[]): AfiszkaPart[] {
  const all = entries.filter((e) => e.exhibition);
  const timed = entries.filter((e) => !e.exhibition);
  const out: AfiszkaPart[] = [
    { label: AFISZKA.allDay, range: null, allDay: true, cells: all },
    { label: AFISZKA.morning, range: '–13:00', allDay: false, cells: timed.filter((e) => hourOf(e.first) < 13) },
    {
      label: AFISZKA.afternoon, range: '13:00–18:00', allDay: false,
      cells: timed.filter((e) => hourOf(e.first) >= 13 && hourOf(e.first) < 18),
    },
    { label: AFISZKA.evening, range: '18:00–', allDay: false, cells: timed.filter((e) => hourOf(e.first) >= 18) },
  ];
  return out.filter((p) => p.cells.length > 0);
}

/**
 * One block per week of the issue. A show running across weeks appears once,
 * in the week of its first performance, with all its dates (§4.2).
 */
function weeks(entries: AfiszkaEntry[], from: Date, days: number): AfiszkaWeek[] {
  const start = startOfDay(from).getTime();
  const count = Math.max(1, Math.ceil(days / 7));
  const out: AfiszkaWeek[] = [];
  for (let w = 0; w < count; w++) {
    const wFrom = new Date(start + w * 7 * DAY_MS);
    const wTo = new Date(start + Math.min(w * 7 + 6, days - 1) * DAY_MS);
    const inWeek = entries.filter((e) => {
      const i = Math.floor((startOfDay(new Date(e.first)).getTime() - start) / DAY_MS);
      const idx = Math.min(Math.max(Math.floor(i / 7), 0), count - 1);
      return idx === w;
    });
    if (inWeek.length === 0) continue;
    out.push({
      label: AFISZKA.week(w + 1),
      span: daySpan(wFrom.toISOString(), wTo.toISOString()),
      entries: inWeek,
    });
  }
  return out;
}

/** Entries per venue, in the reader's venue order; venues it does not name
 *  follow in the order their first entry runs, so none is dropped. */
function byVenue(section: BriefSection, entries: AfiszkaEntry[]): { name: string; entries: AfiszkaEntry[] }[] {
  const groups = new Map<string, { name: string; entries: AfiszkaEntry[] }>();
  const idOf = new Map(section.events.map((e) => [e.id, e.venueId]));
  for (const e of entries) {
    const id = idOf.get(e.ids[0]!) ?? e.venue;
    const g = groups.get(id);
    if (g) g.entries.push(e);
    else groups.set(id, { name: e.venue, entries: [e] });
  }
  const order = section.venueOrder ?? [];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  return [...groups.entries()]
    .map(([id, g], i) => ({ id, g, i }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i)
    .map(({ g }) => g);
}

function timelineDays(from: Date, days: number): string[] {
  const start = startOfDay(from).getTime();
  return Array.from({ length: Math.min(days, 31) }, (_, i) => new Date(start + i * DAY_MS).toISOString());
}

/** Where on a day grid an exhibition's bar starts and ends, 0-based and
 *  inclusive, clamped to the grid. */
export function barSpan(entry: AfiszkaEntry, days: string[]): { from: number; to: number } {
  const first = startOfDay(new Date(days[0]!)).getTime();
  const idx = (iso: string) => Math.round((startOfDay(new Date(iso)).getTime() - first) / DAY_MS);
  const last = days.length - 1;
  const from = entry.run ? Math.max(0, idx(entry.run.opens)) : 0;
  const to = entry.run?.closes ? Math.min(last, idx(entry.run.closes)) : last;
  return { from: Math.min(from, last), to: Math.max(Math.min(from, last), to) };
}

function sectionSpan(entries: AfiszkaEntry[], kind: AfiszkaIssue['kind']): string {
  const timed = entries.filter((e) => !e.exhibition).flatMap((e) => e.occurrences).sort();
  if (timed.length === 0) return '';
  const a = timed[0]!;
  const b = timed[timed.length - 1]!;
  if (kind === 'daily' || dayKey(a) === dayKey(b)) {
    return time(a) === time(b) ? time(a) : `${time(a)} → ${time(b)}`;
  }
  return daySpan(a, b);
}

/**
 * Build the issue a reader will get.
 *
 * Daily for a daily newsletter: a hero, three more picks, Want to go, then the
 * day by category. Outlook for a weekly or monthly one: contents with each
 * section's picks, Closing soon, Want to go, then each section by week.
 */
export function buildAfiszkaIssue(content: AfiszkaContent): AfiszkaIssue {
  const now = content.now ?? new Date();
  const frequency: NewsletterFrequency = content.fallbackFrequency ?? 'daily';
  const kind: AfiszkaIssue['kind'] = frequency === 'daily' ? 'daily' : 'outlook';
  const days = cadenceDays(frequency);

  const saved = buildSaved(content.wantToGo, now, days);
  const savedIds = new Set(saved.flatMap((s) => s.entry.ids));

  const built = content.sections
    .filter((s) => s.events.length > 0)
    .map((s) => ({ section: s, entries: buildEntries(s, now, Math.max(days, s.windowDays)) }));

  // An event both picked and saved shows once, in Want to go (§2.2).
  const isSaved = (e: AfiszkaEntry) => e.ids.some((id) => savedIds.has(id));
  const order = new Map(built.map((b, i) => [b.section.category, i]));
  const candidates = built
    .flatMap((b) => b.entries)
    .filter((e) => e.pick && !isSaved(e))
    .sort((a, b) =>
      dayKey(a.first).localeCompare(dayKey(b.first))
      || (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0)
      || a.first.localeCompare(b.first));

  let hero: AfiszkaEntry | null = null;
  let morePicks: AfiszkaEntry[] = [];
  const sectionPicks = new Map<string, AfiszkaEntry[]>();
  if (kind === 'daily') {
    hero = candidates.find((e) => !e.exhibition && hourOf(e.first) >= 18) ?? candidates[0] ?? null;
    morePicks = candidates.filter((e) => e !== hero).slice(0, 3);
  } else {
    for (const b of built) {
      const mine = candidates.filter((e) => e.category === b.section.category);
      // Up to three premieres and two openings a section (§4.1).
      const premieres = mine.filter((e) => e.pick?.kind === 'premiere').slice(0, 3);
      const openings = mine.filter((e) => e.pick?.kind === 'opening').slice(0, 2);
      const picks = [...premieres, ...openings].sort((x, y) => x.first.localeCompare(y.first));
      if (picks.length) sectionPicks.set(b.section.category, picks);
    }
  }

  // Closing soon: exhibitions whose run ends inside the issue (§4.1).
  const issueEnd = startOfDay(now).getTime() + (days - 0.5) * DAY_MS;
  const closingSoon = kind === 'outlook'
    ? built
        .flatMap((b) => b.entries)
        .filter((e) => e.run?.closes && new Date(e.run.closes).getTime() < issueEnd && !isSaved(e))
        .sort((a, b) => a.run!.closes!.localeCompare(b.run!.closes!))
        .slice(0, 3)
    : [];

  const front = new Set<string>([
    ...savedIds,
    ...(hero ? hero.ids : []),
    ...morePicks.flatMap((e) => e.ids),
    ...closingSoon.flatMap((e) => e.ids),
  ]);

  const sections: AfiszkaSection[] = built.map(({ section, entries }) => {
    const span = Math.max(days, section.windowDays);
    const blocks: AfiszkaBlock[] = [];
    const timed = entries.filter((e) => !e.exhibition);
    const runs = entries.filter((e) => e.exhibition);
    if (section.groupBy === 'venue') {
      blocks.push({ kind: 'venues', venues: byVenue(section, entries) });
    } else if (kind === 'daily' && span <= 1) {
      if (isTimeBanded(entries)) {
        if (runs.length) blocks.push({ kind: 'parts', parts: parts(runs) });
        blocks.push({ kind: 'bands', bands: bands(timed, section.category) });
      } else {
        blocks.push({ kind: 'parts', parts: parts(entries) });
      }
    } else {
      if (runs.length) blocks.push({ kind: 'timeline', days: timelineDays(now, span), rows: runs });
      if (timed.length) blocks.push({ kind: 'weeks', weeks: weeks(timed, now, span) });
    }
    const picks = sectionPicks.get(section.category) ?? [];
    const premieres = picks.filter((p) => p.pick?.kind === 'premiere').length;
    const openings = picks.length - premieres;
    const count = section.category === 'cinema' ? AFISZKA.count.cinema : AFISZKA.count.other;
    return {
      category: section.category,
      label: afiszkaSectionLabel(section.category),
      detail: section.detail,
      count: count(entries.length),
      span: sectionSpan(entries, kind),
      blocks,
      entries,
      picks,
      reason: [
        premieres ? AFISZKA.count.premieres(premieres) : '',
        openings ? AFISZKA.count.openings(openings) : '',
      ].filter(Boolean).join(' · ') || count(entries.length),
    };
  });

  const allEntries = sections.flatMap((s) => s.entries);
  const eventCount = allEntries.length + saved.filter((s) => !allEntries.some((e) => e.ids.some((id) => s.entry.ids.includes(id)))).length;
  const venueCount = new Set([...allEntries, ...saved.map((s) => s.entry)].map((e) => e.venue).filter(Boolean)).size;
  const name = content.recipientName?.trim() || null;

  const whenValue = kind === 'daily'
    ? longDay(now.toISOString()).date
    : daySpan(now.toISOString(), new Date(startOfDay(now).getTime() + (days - 1) * DAY_MS).toISOString())
        .replace(/\s*–\s*/, ' → ');
  const facts = [
    { label: kind === 'daily' ? longDay(now.toISOString()).weekday : AFISZKA.factWhen[frequency], value: whenValue },
    { label: AFISZKA.factCity, value: 'Warszawa' },
    { label: AFISZKA.factEvents, value: AFISZKA.count.other(eventCount) },
    { label: AFISZKA.factVenues, value: AFISZKA.count.venues(venueCount) },
  ];

  return {
    kind,
    issueNo: content.issueNo ?? null,
    frequency,
    now,
    days,
    name,
    facts,
    dedication: name ? `${name} — ${AFISZKA.dedication}` : capitalise(AFISZKA.dedication),
    hero,
    morePicks,
    saved,
    closingSoon,
    festivals: content.festivals ?? [],
    sections,
    front,
    empty: sections.length === 0 && saved.length === 0,
  };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Whether the listing should print `entry` as a one-line reference. */
export function isReferenced(issue: AfiszkaIssue, entry: AfiszkaEntry): boolean {
  return entry.ids.some((id) => issue.front.has(id));
}

/** "Kino · Kino Muranów" — the meta line under a front-page title. */
export function metaLine(entry: AfiszkaEntry): string {
  return [afiszkaSectionLabel(entry.category), entry.venue].filter(Boolean).join(' · ');
}

/** The "when" a front-page row leads with: the time on a daily, the date
 *  on an outlook (and "Teraz" for a run already open). */
export function frontWhen(issue: AfiszkaIssue, entry: AfiszkaEntry): { big: string; small: string } {
  if (entry.exhibition) {
    const closes = entry.run?.closes;
    if (new Date(entry.first).getTime() <= issue.now.getTime()) {
      return { big: PL.now, small: closes ? closingDate(closes) : '' };
    }
    return { big: dayNumber(entry.first), small: `${weekday(entry.first)} · ${monthAbbr(entry.first)}` };
  }
  if (issue.kind === 'daily') return { big: time(entry.first), small: '' };
  return { big: dayNumber(entry.first), small: `${weekday(entry.first)} · ${monthAbbr(entry.first)}` };
}

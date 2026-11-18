import type { Event } from '@afisz/shared';
import { env } from '../config.js';
import { defaultEventStore } from './event-store.js';
import type { FilmStore } from './film-store.js';
import {
  briefFestivals, briefWindowDays, buildBriefSections, buildWantToGoSection,
  dropFestivalRestatements, fetchBriefEvents, plannedFrequency, resolveBriefVenues,
  type BriefSection,
} from './newsletter.js';
import type { NewsletterBrief } from './newsletter-design.js';
import type { NewsletterSaveInput } from './newsletter-input.js';
import { briefPdfFilename } from './newsletter-pdf.js';
import type { NewsletterStore } from './newsletter-store.js';
import type { UserVenueStore } from './user-venue-store.js';
import type { WantToGoStore } from './want-to-go-store.js';

/**
 * The issue a newsletter's settings would produce right now, without sending
 * anything or recording any send state.
 *
 * Two callers: "Generate" in the app (GOI-28) and the per-newsletter API that
 * external services such as printed.sh read (GOI-152). Before GOI-152 this
 * lived inline in the `preview` procedure; it moved here so that what a
 * printing service fetches is provably the same issue the reader sees when
 * they press Generate, not a second assembly that could drift from it.
 */

export interface NewsletterIssueDeps {
  userVenues: UserVenueStore;
  newsletter: Pick<NewsletterStore, 'changesFor'>;
  wantToGo: WantToGoStore;
  films: FilmStore;
}

export interface NewsletterIssue {
  now: Date;
  sections: BriefSection[];
  brief: NewsletterBrief;
  /** The name the PDF is offered under. */
  pdfFilename: string;
}

export async function buildNewsletterIssue(
  userId: string,
  input: NewsletterSaveInput,
  deps: NewsletterIssueDeps,
  now: Date = new Date(),
): Promise<NewsletterIssue> {
  const venues = await resolveBriefVenues(userId, input.venueIds, deps.userVenues);
  // The same fetch the sweep makes, so the issue is what would actually be
  // sent — including its per-rule top-ups, without which a cinema-heavy folder
  // showed cinema and nothing else.
  const all = env.DATABASE_URL
    ? await fetchBriefEvents(input, venues, now, defaultEventStore)
    : [];
  // Scoped like the send is (GOI-33). If the reader follows nothing yet,
  // scoping to an empty list would hide the band, so it is left unscoped.
  const festivals = briefFestivals(
    briefWindowDays(plannedFrequency(input)),
    venues.length > 0 ? venues.map((v) => v.name) : undefined,
    now,
  );
  // A row that only restates a festival the band names is the same fact
  // printed twice in one issue (GOI-124). A section whose cadence isn't due
  // today is absent, the same rule the sweep applies.
  const sections = dropFestivalRestatements(
    buildBriefSections(all, input, venues, now),
    festivals,
  );
  /**
   * The saved-events queue (GOI-110), built without send-state dedup. Nothing
   * here sends, so nothing is consumed; suppressing what a previous issue
   * already announced would leave the block empty precisely because the
   * feature has been working.
   */
  const wantToGo = await buildWantToGoSection(
    { id: 'preview', userId, wantToGo: input.wantToGo, sendCadence: input.sendCadence },
    {
      sentStates: async () => new Set<string>(),
      changesFor: (ids, since) => deps.newsletter.changesFor(ids, since),
    },
    deps.wantToGo,
    now,
    // A tracked title that has just been announced belongs here for the same
    // reason it belongs in the issue (GOI-112).
    { films: deps.films, events: defaultEventStore },
  );
  const brief: NewsletterBrief = {
    sections,
    wantToGo,
    fallbackFrequency: plannedFrequency(input),
    recipientName: input.recipientName,
    festivals,
    design: input.design,
    now,
    // For a daily issue's poster PDF. Its issue number is left off: this is
    // not a numbered, sent issue.
    savedEventIds: input.wantToGo?.enabled === false
      ? []
      : (await deps.wantToGo.list(userId)).map((e) => e.id),
  };
  return { now, sections, brief, pdfFilename: briefPdfFilename(now, plannedFrequency(input)) };
}

/** One event as the JSON form of an issue carries it. */
export interface IssueEventJson {
  id: string;
  title: string;
  kind: 'timed' | 'exhibition';
  category: string;
  startsAt: string;
  endsAt: string | null;
  venue: string | null;
  description: string | null;
  longDescription: string | null;
  director: string | null;
  durationMinutes: number | null;
  /** In PLN, not grosze: an outside service should not need to know. */
  priceMin: number | null;
  priceMax: number | null;
  url: string;
}

function eventJson(e: Event): IssueEventJson {
  return {
    id: e.id,
    title: e.title,
    kind: e.kind === 'exhibition' ? 'exhibition' : 'timed',
    category: e.category,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    venue: e.venue?.name ?? null,
    description: e.description,
    longDescription: e.longDescription ?? null,
    director: e.director,
    durationMinutes: e.durationMinutes,
    priceMin: e.priceMin == null ? null : e.priceMin / 100,
    priceMax: e.priceMax == null ? null : e.priceMax / 100,
    url: e.sourceUrl,
  };
}

/**
 * The issue as structured data, for a service that lays the page out itself.
 *
 * A stable, documented shape rather than the internal brief: the brief's types
 * change whenever the PDF does, and an outside integration should not break
 * when they do. `version` is bumped on any breaking change.
 */
export function issueJson(
  settings: { id: string; name: string; design: string; sendCadence: string; timezone: string },
  issue: NewsletterIssue,
) {
  const { brief } = issue;
  return {
    version: 1,
    newsletter: {
      id: settings.id,
      name: settings.name,
      design: settings.design,
      cadence: settings.sendCadence,
      timezone: settings.timezone,
    },
    generatedAt: issue.now.toISOString(),
    recipientName: brief.recipientName ?? null,
    pdf: { filename: issue.pdfFilename },
    festivals: (brief.festivals ?? []).map((f) => ({
      name: f.name,
      url: f.url ?? null,
      startDate: f.startDate,
      endDate: f.endDate,
    })),
    wantToGo: {
      reminders: (brief.wantToGo?.reminders ?? []).map((r) => ({ state: r.state, event: eventJson(r.event) })),
      changes: (brief.wantToGo?.changes ?? []).map((c) => ({
        type: c.type,
        oldValue: c.oldValue,
        newValue: c.newValue,
        event: eventJson(c.event),
      })),
    },
    sections: issue.sections.map((s) => ({
      category: s.category,
      detail: s.detail,
      windowDays: s.windowDays,
      events: s.events.map(eventJson),
    })),
  };
}

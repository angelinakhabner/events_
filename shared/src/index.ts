export type Category =
  | 'cinema'
  | 'theatre'
  | 'exhibition'
  | 'comedy'
  | 'music'
  | 'other';

export interface Venue {
  id: string;
  name: string;
  url: string;
  city: string;
  country: string;
  category: Category;
  language: string;
  timezone: string;
  createdAt: string;
}

export interface Event {
  id: string;
  venueId: string;
  /** Inline venue summary — populated by events.listDefault and listByVenue
   *  so the frontend doesn't need a separate venues.list join. Optional so
   *  pure unit tests and mock data can construct events without a venue. */
  venue?: EventVenue;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  category: Category;
  language: string | null;
  director: string | null;
  cast: string[];
  durationMinutes: number | null;
  /** In grosze (1/100 PLN). e.g. 2200 = 22 PLN. */
  priceMin: number | null;
  priceMax: number | null;
  sourceUrl: string;
  sourceId: string | null;
  scrapedAt: string;
}

/** Subset of Venue carried inline on Event responses. */
export interface EventVenue {
  id: string;
  name: string;
  category: Category;
  city: string;
  country: string;
}

export interface Folder {
  id: string;
  userId: string | null;
  name: string;
  venueIds: string[];
  filters: EventFilters;
  createdAt: string;
}

export interface EventFilters {
  categories?: Category[];
  cities?: string[];
  countries?: string[];
  daysOfWeek?: number[];
  startHour?: number;
  endHour?: number;
  priceMax?: number;
}

export interface VenueListInput {
  city?: string;
  country?: string;
  category?: Category;
}

export interface ScrapeRun {
  id: string;
  venueId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'success_empty' | 'failed' | 'skipped_unchanged';
  eventsFound: number | null;
  errorMessage: string | null;
  rawHash: string | null;
}

// ─── Films (want to watch / seen) ────────────────────────────────────────────

export type FilmStatus = 'want' | 'seen';

export interface Film {
  id: string;
  title: string;
  status: FilmStatus;
  /** Where it was watched — free text, filled when moving to "seen". */
  watchedVenue: string | null;
  /** Short personal note, filled when moving to "seen". */
  comment: string | null;
  watchedAt: string | null;
  createdAt: string;
}

// ─── Want to go ──────────────────────────────────────────────────────────────

/** A saved event, plus when (if ever) the user marked it seen. */
export interface WantToGoEntry {
  event: Event;
  /** ISO instant the entry was marked seen; null while it's still upcoming. */
  seenAt: string | null;
  savedAt: string;
}

// ─── Newsletter ──────────────────────────────────────────────────────────────

export type NewsletterFrequency = 'daily' | 'weekly';

export interface NewsletterSettings {
  email: string;
  frequency: NewsletterFrequency;
  /** Venues the brief covers; empty = all of the user's venues. */
  venueIds: string[];
  /** Only include events starting at/after this hour (0-23), e.g. 18 = after 6 pm. */
  afterHour: number | null;
  /** Only include events starting before this hour (0-23). */
  beforeHour: number | null;
  /** Warsaw hour the brief is sent at (0-23). */
  sendHour: number;
  /** Weekday weekly briefs go out on (0=Sun … 6=Sat). Ignored when daily. */
  sendWeekday: number;
  /** Narrows the brief to venues you tagged with one of these. Empty = every
   *  venue in `venueIds`. */
  eventTags: string[];
  enabled: boolean;
  lastSentAt: string | null;
}

// ─── Festivals ───────────────────────────────────────────────────────────────

export interface Festival {
  id: string;
  name: string;
  url: string;
  /** Cinemas (venue names) hosting the festival. */
  cinemas: string[];
  city: string;
  /** ISO dates (YYYY-MM-DD), inclusive. */
  startDate: string;
  endDate: string;
  description: string;
  status: 'ongoing' | 'upcoming';
}

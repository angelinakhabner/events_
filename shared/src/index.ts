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
  status: 'running' | 'success' | 'failed' | 'skipped_unchanged';
  eventsFound: number | null;
  errorMessage: string | null;
  rawHash: string | null;
}

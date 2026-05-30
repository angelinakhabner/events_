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
  createdAt: string;
}

export interface Event {
  id: string;
  venueId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  durationMinutes: number | null;
  director: string | null;
  cast: string[];
  genre: string | null;
  priceMin: number | null;
  priceMax: number | null;
  link: string;
  scrapedAt: string;
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

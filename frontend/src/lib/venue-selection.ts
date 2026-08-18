import type { VenueFilterOption } from '@afisz/shared';

/**
 * Which venues are selected, remembered per category (GOI-76 §5).
 *
 * Not a flat `VenueId[]`: selecting two cinemas, clicking THEATRE and coming
 * back must find those two still selected. Losing the selection on every tab
 * switch is the kind of friction that makes a filter bar feel hostile, and the
 * per-category shape is what prevents it — a venue id also means nothing under
 * a category it doesn't belong to.
 *
 * An absent or empty array means "All".
 */
export type VenueSelection = Record<string, string[]>;

/** Categories are nullable in the UI (the ALL tab); the map needs a key. */
export const ALL_KEY = '__all__';

export function categoryKey(category: string | null): string {
  return category ?? ALL_KEY;
}

export function selectionFor(selection: VenueSelection, category: string | null): string[] {
  return selection[categoryKey(category)] ?? [];
}

export function withSelection(
  selection: VenueSelection,
  category: string | null,
  venueIds: string[],
): VenueSelection {
  const next = { ...selection };
  if (venueIds.length === 0) delete next[categoryKey(category)];
  else next[categoryKey(category)] = venueIds;
  return next;
}

/**
 * Selected ids → slugs for the URL.
 *
 * Slugs rather than UUIDs so a shared link reads as `?venues=muranow,iluzjon`
 * and survives a database that was reseeded with fresh ids.
 */
export function selectionToSlugs(venueIds: string[], venues: VenueFilterOption[]): string[] {
  const byId = new Map(venues.map((v) => [v.id, v.slug]));
  return venueIds.map((id) => byId.get(id)).filter((s): s is string => !!s);
}

/**
 * Slugs from the URL → ids we can filter with.
 *
 * Unknown or stale slugs are dropped silently. A link shared last month whose
 * venue has since been removed should still open the page it mostly meant,
 * not an error — nothing here is worth failing a page load over.
 */
export function slugsToSelection(slugs: string[], venues: VenueFilterOption[]): string[] {
  const bySlug = new Map(venues.map((v) => [v.slug, v.id]));
  return slugs.map((s) => bySlug.get(s.trim())).filter((id): id is string => !!id);
}

export function parseSlugParam(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

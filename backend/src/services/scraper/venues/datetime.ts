// Timezone-correct date/time helpers shared by the deterministic venue
// scrapers. Venue pages carry local wall-clock times (and often a bogus or
// absent UTC offset), so each scraper stamps showtimes with the venue
// timezone's real offset at that instant instead of trusting the markup.

/**
 * The numeric UTC offset (e.g. "+02:00") of `timeZone` at the given instant.
 * Used to stamp each showtime with the real local offset (CEST/CET) instead of
 * whatever the page's markup claims.
 */
export function tzOffsetAt(instant: Date, timeZone: string): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  // "GMT+2", "GMT+02:00", "GMT-01:00" → "+02:00" / "-01:00"
  const m = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) return '+00:00';
  return `${m[1]}${m[2]!.padStart(2, '0')}:${m[3] ?? '00'}`;
}

/** Build an ISO start from a YYYY-MM-DD day + HH:MM hour, or null if malformed. */
export function toStartsAt(day: string, hour: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const m = hour.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = m[1]!.padStart(2, '0');
  const mm = m[2]!;
  const offset = tzOffsetAt(new Date(`${day}T${hh}:${mm}:00Z`), timeZone);
  return `${day}T${hh}:${mm}:00${offset}`;
}

/** YYYY-MM-DD rendering of `date` in `timeZone`. */
export function ymdInTz(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

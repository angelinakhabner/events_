import type { Event } from '@goin/shared';

export type BucketKey = 'soon' | 'today' | 'tomorrow' | 'thisWeek';

export interface Bucket {
  key: BucketKey;
  label: string;
  items: Event[];
}

const TZ = 'Europe/Warsaw';
const SOON_WINDOW_MS = 30 * 60 * 1000;
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Group events into the four time buckets used on the Home page. */
export function bucketEvents(events: Event[], now: Date = new Date()): Bucket[] {
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const soonCutoff = now.getTime() + SOON_WINDOW_MS;
  const weekCutoff = now.getTime() + WEEK_WINDOW_MS;
  const todayDay = warsawDayKey(now);
  const tomorrowDay = warsawDayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const buckets: Record<BucketKey, Event[]> = {
    soon: [],
    today: [],
    tomorrow: [],
    thisWeek: [],
  };

  for (const e of sorted) {
    const t = Date.parse(e.startsAt);
    if (Number.isNaN(t) || t < now.getTime()) continue;
    const day = warsawDayKey(new Date(t));
    if (t <= soonCutoff) {
      buckets.soon.push(e);
    } else if (day === todayDay) {
      buckets.today.push(e);
    } else if (day === tomorrowDay) {
      buckets.tomorrow.push(e);
    } else if (t <= weekCutoff) {
      buckets.thisWeek.push(e);
    }
  }

  const ordered: Bucket[] = [
    { key: 'soon', label: 'Starting soon', items: buckets.soon },
    { key: 'today', label: 'Later today', items: buckets.today },
    { key: 'tomorrow', label: 'Tomorrow', items: buckets.tomorrow },
    { key: 'thisWeek', label: 'This week', items: buckets.thisWeek },
  ];
  return ordered.filter((b) => b.items.length > 0);
}

/** YYYY-MM-DD in Europe/Warsaw. */
export function warsawDayKey(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d);
}

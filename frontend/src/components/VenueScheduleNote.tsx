import type { VenueSchedule } from '@afisz/shared';
import { plural } from '../lib/format';

const dayFmt = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw',
});

/**
 * The "dark until 19 Sep" line next to a venue (GOI-13).
 *
 * Theatres go dark between seasons and museums close for a re-hang. Without
 * this the venue is indistinguishable from one whose scraper broke, so the
 * note has to be visible on the venue itself rather than inferred from an
 * empty listing.
 *
 * Renders nothing while a venue is running — a badge on every row would be
 * noise, and the interesting state is the exception.
 */
export function VenueScheduleNote({ schedule }: { schedule: VenueSchedule | undefined }) {
  if (!schedule || schedule.state === 'running') return null;

  if (schedule.state === 'dark') {
    return (
      <span
        className="text-muted"
        title="Brak nadchodzących wydarzeń. Miejsce może być zamknięte albo program nie został jeszcze opublikowany."
      >
        brak wydarzeń
      </span>
    );
  }

  const until = schedule.nextStartsAt ? dayFmt.format(new Date(schedule.nextStartsAt)) : null;
  return (
    <span
      className="text-accent"
      title={`Przez ${schedule.daysUntilNext} ${plural(schedule.daysUntilNext ?? 0, 'dzień', 'dni', 'dni')} nic się tu nie dzieje — najbliższe wydarzenie: ${until}.`}
    >
      przerwa do {until}
    </span>
  );
}

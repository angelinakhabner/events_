import type { VenueSchedule } from '@goin/shared';

const dayFmt = new Intl.DateTimeFormat('en-GB', {
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
        className="ml-3 text-xs text-muted"
        title="No upcoming events found. The venue may be closed, or its programme may not be published yet."
      >
        nothing listed
      </span>
    );
  }

  const until = schedule.nextStartsAt ? dayFmt.format(new Date(schedule.nextStartsAt)) : null;
  return (
    <span
      className="ml-3 text-xs text-accent"
      title={`Nothing on for ${schedule.daysUntilNext} more days — the next event here is on ${until}.`}
    >
      dark until {until}
    </span>
  );
}

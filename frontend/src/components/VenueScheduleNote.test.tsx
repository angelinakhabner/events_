import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { VenueSchedule } from '@afisz/shared';
import { VenueScheduleNote } from './VenueScheduleNote';

const quiet: VenueSchedule = {
  state: 'quiet',
  nextStartsAt: '2026-09-19T18:00:00+02:00',
  upcomingCount: 4,
  daysUntilNext: 53,
};

describe('VenueScheduleNote', () => {
  it('names the date a quiet venue comes back', () => {
    render(<VenueScheduleNote schedule={quiet} />);
    expect(screen.getByText(/dark until 19 Sep/i)).toBeInTheDocument();
  });

  it('explains the gap on hover rather than in the row', () => {
    render(<VenueScheduleNote schedule={quiet} />);
    expect(screen.getByTitle(/53 more days/)).toBeInTheDocument();
  });

  it('formats the date in Warsaw time, not the viewer\'s', () => {
    // 22:30Z on 18 Sep is already 00:30 on the 19th in Warsaw.
    render(
      <VenueScheduleNote
        schedule={{ ...quiet, nextStartsAt: '2026-09-18T22:30:00.000Z' }}
      />,
    );
    expect(screen.getByText(/19 Sep/)).toBeInTheDocument();
  });

  it('says "nothing listed" when there is no next date to name', () => {
    render(
      <VenueScheduleNote
        schedule={{ state: 'dark', nextStartsAt: null, upcomingCount: 0, daysUntilNext: null }}
      />,
    );
    expect(screen.getByText('nothing listed')).toBeInTheDocument();
    // The copy must not claim the venue is closed — an unpublished programme
    // looks identical from here.
    expect(screen.getByTitle(/may be closed, or its programme may not be published/i)).toBeInTheDocument();
  });

  it('renders nothing for a running venue, or before the data arrives', () => {
    const { container, rerender } = render(
      <VenueScheduleNote
        schedule={{ state: 'running', nextStartsAt: '2026-07-29T18:00:00Z', upcomingCount: 9, daysUntilNext: 1 }}
      />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<VenueScheduleNote schedule={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

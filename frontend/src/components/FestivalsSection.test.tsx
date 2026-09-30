import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FestivalsSection, formatRange } from './FestivalsSection';

/** What the mocked query returns, and what it was asked for. */
let data: unknown[] | undefined;
const useQuery = vi.fn();

vi.mock('../lib/trpc', () => ({
  trpc: { festivals: { list: { useQuery: (...a: unknown[]) => useQuery(...a) } } },
}));

const FESTIVAL = {
  id: 'wff-2026',
  name: 'Warsaw Film Festival',
  url: 'https://wff.pl',
  category: 'cinema' as const,
  venues: ['Kinoteka', 'Kino Muranów'],
  city: 'Warsaw',
  startDate: '2026-10-09',
  endDate: '2026-10-18',
  description: 'Premieres and competitions.',
  status: 'upcoming' as const,
};

beforeEach(() => {
  data = [FESTIVAL];
  useQuery.mockReset();
  useQuery.mockImplementation(() => ({ data }));
});

/**
 * GOI-68: festivals belong to the listing they are for. They used to be one
 * cinema-only block shown on the unfiltered view and the cinema tab, which put
 * film festivals under Theatre whenever no category was selected.
 */
describe('FestivalsSection — which listing it belongs to', () => {
  it('asks for the selected listing\'s own festivals', () => {
    render(<FestivalsSection category="theatre" />);
    expect(useQuery).toHaveBeenCalledWith({ category: 'theatre' }, expect.objectContaining({ enabled: true }));
  });

  // No category is the unfiltered view, which shows all of them.
  it('asks for everything when no category is selected', () => {
    render(<FestivalsSection category={null} />);
    expect(useQuery).toHaveBeenCalledWith(undefined, expect.objectContaining({ enabled: true }));
  });

  // Exhibitions and "other" have no festivals, so the query is never run —
  // asking with no category would have shown cinema festivals under Museums.
  it.each(['exhibition', 'other'] as const)('asks for nothing under %s', (category) => {
    render(<FestivalsSection category={category} />);
    expect(useQuery).toHaveBeenCalledWith(undefined, expect.objectContaining({ enabled: false }));
    expect(screen.queryByText('Wkrótce')).not.toBeInTheDocument();
  });

  it('renders nothing at all when the listing has no festivals', () => {
    data = [];
    const { container } = render(<FestivalsSection category="cinema" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the query is still loading', () => {
    data = undefined;
    const { container } = render(<FestivalsSection category="cinema" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('FestivalsSection — the row', () => {
  // Pinned well before the fixture's 9 October start. Against the real clock
  // these started failing a fortnight out, the day the festival moved into the
  // banner's window (GOI-99) and so, correctly, out of this block.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-01T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('heads the block "Coming soon"', () => {
    render(<FestivalsSection category="cinema" />);
    expect(screen.getByRole('heading', { name: 'Wkrótce' })).toBeInTheDocument();
  });

  it('shows the festival as a linked title with its dates, hosts and blurb', () => {
    render(<FestivalsSection category="cinema" />);
    expect(screen.getByRole('link', { name: 'Warsaw Film Festival' })).toHaveAttribute('href', 'https://wff.pl');
    expect(screen.getByText('9–18 paź')).toBeInTheDocument();
    expect(screen.getByText('Kinoteka · Kino Muranów')).toBeInTheDocument();
    expect(screen.getByText('Premieres and competitions.')).toBeInTheDocument();
  });

  it('marks an upcoming festival as upcoming and an ongoing one as now on', () => {
    render(<FestivalsSection category="cinema" />);
    expect(screen.getByText('Nadchodzi')).toBeInTheDocument();

    data = [{ ...FESTIVAL, status: 'ongoing' as const }];
    render(<FestivalsSection category="cinema" />);
    expect(screen.getByText('Trwa')).toBeInTheDocument();
  });
});

describe('formatRange', () => {
  it('collapses same-month ranges', () => {
    expect(formatRange('2026-10-09', '2026-10-18')).toBe('9–18 paź');
  });

  it('spells out cross-month ranges', () => {
    expect(formatRange('2026-06-19', '2026-08-30')).toBe('19 cze – 30 sie');
  });

  it('shows a single day once', () => {
    expect(formatRange('2026-11-11', '2026-11-11')).toBe('11 lis');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Audience, ContentCategory, Event } from '@afisz/shared';
import {
  ContentCategoryBar,
  countByContentCategory,
  filterByContent,
} from './ContentCategoryBar';

/** The UI half of GOI-80: hierarchy at render time, never in storage. */

let seq = 0;
function evt(
  contentCategory: ContentCategory | null,
  audience: Audience | null = null,
): Event {
  seq += 1;
  return {
    id: `e${seq}`,
    venueId: 'v',
    title: `Event ${seq}`,
    description: null,
    startsAt: '2026-09-01T18:00:00.000Z',
    endsAt: null,
    category: 'exhibition',
    language: null,
    director: null,
    cast: [],
    durationMinutes: null,
    priceMin: null,
    priceMax: null,
    sourceUrl: 'https://x.example/1',
    sourceId: null,
    contentCategory,
    audience,
    scrapedAt: '',
  };
}

function Harness({ events }: { events: Event[] }) {
  const [selected, setSelected] = useState<ContentCategory[]>([]);
  const [family, setFamily] = useState(false);
  return (
    <>
      <ContentCategoryBar
        events={events}
        selected={selected}
        onChange={setSelected}
        familyOnly={family}
        onFamilyChange={setFamily}
      />
      <output data-testid="shown">{filterByContent(events, selected, family).length}</output>
    </>
  );
}

const shown = () => Number(screen.getByTestId('shown').textContent);

describe('chips are derived from the result set, not hardcoded', () => {
  // A static row of nine chips where seven return nothing recreates the empty
  // state problem from the other direction.
  it('renders only the types actually present', () => {
    render(
      <Harness events={[evt('workshop'), evt('workshop'), evt('guided_tour')]} />,
    );
    expect(screen.getByRole('button', { name: /^Workshops, 2 events/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Guided tours, 1 event\b/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Concerts/ })).not.toBeInTheDocument();
  });

  it('orders by count, busiest first', () => {
    render(<Harness events={[evt('lecture'), evt('concert'), evt('concert')]} />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels[0]).toMatch(/^Concerts, 2/);
    expect(labels[1]).toMatch(/^Talks, 1/);
  });

  // "other" is a real answer the classifier gives; "not looked at yet" is not.
  it('skips unclassified rows rather than calling them "other"', () => {
    expect(countByContentCategory([evt(null), evt(null), evt('other')]))
      .toEqual([{ category: 'other', count: 1 }]);
  });

  it('renders nothing when there is only one type and no family events', () => {
    const { container } = render(<Harness events={[evt('workshop'), evt('workshop')]} />);
    expect(container.querySelector('[role="group"]')).toBeNull();
  });

  it('renders nothing when nothing is classified at all', () => {
    const { container } = render(<Harness events={[evt(null), evt(null)]} />);
    expect(container.querySelector('[role="group"]')).toBeNull();
  });

  it('is a labelled group when it does render', () => {
    render(<Harness events={[evt('workshop'), evt('concert')]} />);
    expect(screen.getByRole('group', { name: 'Filter by type' })).toBeInTheDocument();
  });
});

describe('selection is OR within the row', () => {
  it('narrows to one type, then widens to two', () => {
    render(<Harness events={[evt('workshop'), evt('concert'), evt('lecture')]} />);
    expect(shown()).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: /^Workshops/ }));
    expect(shown()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: /^Concerts/ }));
    expect(shown()).toBe(2);
  });

  it('deselects back to everything', () => {
    render(<Harness events={[evt('workshop'), evt('concert')]} />);
    const workshops = screen.getByRole('button', { name: /^Workshops/ });
    fireEvent.click(workshops);
    expect(shown()).toBe(1);
    fireEvent.click(workshops);
    expect(shown()).toBe(2);
  });

  it('marks selection with aria-pressed', () => {
    render(<Harness events={[evt('workshop'), evt('concert')]} />);
    const workshops = screen.getByRole('button', { name: /^Workshops/ });
    expect(workshops).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(workshops);
    expect(workshops).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('family is a separate axis, not a category (GOI-80 Field 3)', () => {
  // Putting family among the chips would make choosing it silently drop the
  // workshop signal — that is the bug the separate field exists to prevent.
  it('is not one of the category chips', () => {
    render(<Harness events={[evt('workshop', 'family'), evt('concert')]} />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels.filter((l) => /^For families/.test(l))).toHaveLength(1);
    // …and the family workshop still counts as a workshop.
    expect(screen.getByRole('button', { name: /^Workshops, 1 event\b/ })).toBeInTheDocument();
  });

  it('ANDs with the category selection rather than replacing it', () => {
    render(
      <Harness
        events={[
          evt('workshop', 'family'),
          evt('workshop'),
          evt('concert', 'family'),
        ]}
      />,
    );
    expect(shown()).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: /^Workshops/ }));
    expect(shown()).toBe(2);

    // Workshops AND family — one row, not "workshops or family".
    fireEvent.click(screen.getByRole('button', { name: /^For families/ }));
    expect(shown()).toBe(1);
  });

  it('is hidden when nothing is for families', () => {
    render(<Harness events={[evt('workshop'), evt('concert')]} />);
    expect(screen.queryByRole('button', { name: /For families/ })).not.toBeInTheDocument();
  });

  it('shows on its own even when there is only one category', () => {
    render(<Harness events={[evt('workshop', 'family'), evt('workshop')]} />);
    expect(screen.getByRole('button', { name: /^For families, 1 event\b/ })).toBeInTheDocument();
  });
});

describe('filterByContent', () => {
  it('treats an empty selection as "all types", not "none"', () => {
    const events = [evt('workshop'), evt('concert')];
    expect(filterByContent(events, [], false)).toHaveLength(2);
  });

  it('drops unclassified rows once a type is chosen', () => {
    const events = [evt('workshop'), evt(null)];
    expect(filterByContent(events, ['workshop'], false)).toHaveLength(1);
  });

  it('applies family on its own', () => {
    const events = [evt('workshop', 'family'), evt('concert')];
    expect(filterByContent(events, [], true)).toHaveLength(1);
  });
});

// The chips must count over the set *before* this row's own filter, or picking
// one makes every other chip read 0 — the same trap as the venue counts.
describe('counts ignore this row’s own selection', () => {
  it('keeps every chip’s count while one is selected', () => {
    const events = [evt('workshop'), evt('concert'), evt('concert')];
    const onChange = vi.fn();
    const { rerender } = render(
      <ContentCategoryBar
        events={events} selected={[]} onChange={onChange}
        familyOnly={false} onFamilyChange={vi.fn()}
      />,
    );
    const before = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));

    rerender(
      <ContentCategoryBar
        events={events} selected={['workshop']} onChange={onChange}
        familyOnly={false} onFamilyChange={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(before);
  });
});

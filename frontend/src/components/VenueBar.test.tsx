import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { VenueFilterOption } from '@afisz/shared';
import { VenueBar } from './VenueBar';
import {
  parseSlugParam, selectionFor, selectionToSlugs, slugsToSelection, withSelection,
  type VenueSelection,
} from '../lib/venue-selection';

/** Queried by role and accessible name throughout, per the ticket. */

function venue(over: Partial<VenueFilterOption> & { name: string }): VenueFilterOption {
  return {
    category: 'cinema',
    count: 0,
    status: 'active',
    lastScrapedAt: null,
    ...over,
    id: over.id ?? over.name.toLowerCase(),
    slug: over.slug ?? over.name.toLowerCase(),
  };
}

const MURANOW = venue({ name: 'Muranow', count: 12 });
const KINOTEKA = venue({ name: 'Kinoteka', count: 8 });
const ILUZJON = venue({ name: 'Iluzjon', count: 5 });
const ATLANTIC = venue({ name: 'Atlantic', count: 0 });
const ALL_FOUR = [MURANOW, KINOTEKA, ILUZJON, ATLANTIC];

/** Drives the component the way the page does, so selection is real state. */
function Harness({
  venues = ALL_FOUR,
  category = 'cinema' as string | null,
  initial = [] as string[],
  onSelection,
}: {
  venues?: VenueFilterOption[];
  category?: string | null;
  initial?: string[];
  onSelection?: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState(initial);
  return (
    <VenueBar
      venues={venues}
      selected={selected}
      category={category}
      onChange={(ids) => { setSelected(ids); onSelection?.(ids); }}
    />
  );
}

const chip = (name: RegExp) => screen.getByRole('button', { name });

describe('VenueBar — selection (GOI-76 §1)', () => {
  // "Just show me Muranów" has to be one click, not one click and three
  // deselections.
  it('solos on the first click rather than adding to "all"', () => {
    const onSelection = vi.fn();
    render(<Harness onSelection={onSelection} />);
    fireEvent.click(chip(/^Muranow, 12 events/));
    expect(onSelection).toHaveBeenLastCalledWith([MURANOW.id]);
  });

  it('adds on the second click', () => {
    const onSelection = vi.fn();
    render(<Harness onSelection={onSelection} />);
    fireEvent.click(chip(/^Muranow, 12 events/));
    fireEvent.click(chip(/^Kinoteka, 8 events/));
    expect(onSelection).toHaveBeenLastCalledWith([MURANOW.id, KINOTEKA.id]);
  });

  it('removes one of several without clearing the rest', () => {
    const onSelection = vi.fn();
    render(<Harness initial={[MURANOW.id, KINOTEKA.id]} onSelection={onSelection} />);
    fireEvent.click(chip(/^Muranow, 12 events/));
    expect(onSelection).toHaveBeenLastCalledWith([KINOTEKA.id]);
  });

  it('returns to All when the last selected venue is deselected', () => {
    const onSelection = vi.fn();
    render(<Harness initial={[MURANOW.id]} onSelection={onSelection} />);
    fireEvent.click(chip(/^Muranow, 12 events/));
    expect(onSelection).toHaveBeenLastCalledWith([]);
    expect(chip(/^All venues/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears the subset from "All venues"', () => {
    const onSelection = vi.fn();
    render(<Harness initial={[MURANOW.id, KINOTEKA.id]} onSelection={onSelection} />);
    fireEvent.click(chip(/^All venues/));
    expect(onSelection).toHaveBeenLastCalledWith([]);
  });

  // Multi-select is the one deliberate inconsistency with the rows above, so
  // it has to be visible: filled when on, outline when off.
  it('fills a selected chip and leaves an unselected one outlined', () => {
    render(<Harness initial={[MURANOW.id]} />);
    expect(chip(/^Muranow, 12 events/)).toHaveClass('bg-ink');
    expect(chip(/^Kinoteka, 8 events/)).not.toHaveClass('bg-ink');
  });

  it('marks selection with aria-pressed, since these are toggles', () => {
    render(<Harness initial={[MURANOW.id]} />);
    expect(chip(/^Muranow, 12 events/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^Kinoteka, 8 events/)).toHaveAttribute('aria-pressed', 'false');
    expect(chip(/^All venues/)).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('VenueBar — counts (GOI-76 §2)', () => {
  it('puts the count in the accessible name', () => {
    render(<Harness />);
    expect(chip(/^Muranow, 12 events/)).toBeInTheDocument();
    // Singular reads correctly too.
    render(<Harness venues={[venue({ name: 'Solo', count: 1 })]} />);
    expect(chip(/^Solo, 1 event\b/)).toBeInTheDocument();
  });

  it('sums the row into "All venues"', () => {
    render(<Harness />);
    expect(within(chip(/^All venues/)).getByText('25')).toBeInTheDocument();
  });

  // A visible zero says "watched, nothing on" — different from not covered.
  it('keeps a zero-count venue visible and clickable', () => {
    const onSelection = vi.fn();
    render(<Harness onSelection={onSelection} />);
    const atlantic = chip(/^Atlantic, 0 events/);
    expect(atlantic).toBeInTheDocument();
    fireEvent.click(atlantic);
    expect(onSelection).toHaveBeenLastCalledWith([ATLANTIC.id]);
  });
});

describe('VenueBar — status is text, not just colour (GOI-76 §2, §7)', () => {
  it.each([
    ['empty', /no events listed right now/i],
    ['dark', /can’t currently read/i],
  ] as const)('states why a %s venue reads zero', (status, note) => {
    render(<Harness venues={[venue({ name: 'Quiet', count: 0, status })]} />);
    const el = chip(/^Quiet/);
    expect(el).toHaveAttribute('title', expect.stringMatching(note));
    expect(el.getAttribute('aria-label')).toMatch(note);
  });

  it('says how old a stale venue is, and marks it', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    render(
      <Harness venues={[venue({ name: 'Old', count: 3, status: 'stale', lastScrapedAt: eightDaysAgo })]} />,
    );
    expect(chip(/^Old/)).toHaveAttribute('title', expect.stringMatching(/last updated 8 days ago/i));
  });

  it('strikes through a dark venue’s count — the number is not trustworthy', () => {
    render(<Harness venues={[venue({ name: 'Broken', count: 0, status: 'dark' })]} />);
    expect(within(chip(/^Broken/)).getByText('0')).toHaveClass('line-through');
  });

  it('says "nothing on in this period" for an active venue with a zero', () => {
    render(<Harness venues={[venue({ name: 'Atlantic', count: 0, status: 'active' })]} />);
    expect(chip(/^Atlantic/)).toHaveAttribute('title', 'Nothing on in this period');
  });

  it('adds no note to a healthy venue with events', () => {
    render(<Harness venues={[MURANOW]} />);
    expect(chip(/^Muranow/)).not.toHaveAttribute('title');
  });
});

describe('VenueBar — ordering (GOI-76 §3)', () => {
  const names = () =>
    screen.getAllByRole('button').slice(1).map((b) => b.getAttribute('aria-label')?.split(',')[0]);

  it('sorts by count descending, then by name', () => {
    render(<Harness venues={[ATLANTIC, ILUZJON, MURANOW, KINOTEKA]} />);
    expect(names()).toEqual(['Muranow', 'Kinoteka', 'Iluzjon', 'Atlantic']);
  });

  // If chips reorder on every date click, the thing you were about to click
  // has moved by the time you click it.
  it('holds the order when only the counts change', () => {
    const { rerender } = render(
      <VenueBar venues={ALL_FOUR} selected={[]} onChange={vi.fn()} category="cinema" />,
    );
    expect(names()).toEqual(['Muranow', 'Kinoteka', 'Iluzjon', 'Atlantic']);

    // Same venues, a different day: Atlantic is now the busiest.
    rerender(
      <VenueBar
        venues={[
          { ...MURANOW, count: 0 }, { ...KINOTEKA, count: 1 },
          { ...ILUZJON, count: 2 }, { ...ATLANTIC, count: 30 },
        ]}
        selected={[]}
        onChange={vi.fn()}
        category="cinema"
      />,
    );
    expect(names()).toEqual(['Muranow', 'Kinoteka', 'Iluzjon', 'Atlantic']);
  });

  it('re-sorts when the category changes', () => {
    const theatre = [venue({ name: 'Studio', count: 2 }), venue({ name: 'Powszechny', count: 9 })];
    const { rerender } = render(
      <VenueBar venues={ALL_FOUR} selected={[]} onChange={vi.fn()} category="cinema" />,
    );
    rerender(<VenueBar venues={theatre} selected={[]} onChange={vi.fn()} category="theatre" />);
    expect(names()).toEqual(['Powszechny', 'Studio']);
  });
});

describe('VenueBar — the ALL tab (GOI-76 §4)', () => {
  it('renders nothing at all', () => {
    const { container } = render(<Harness category={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the category has no venues', () => {
    const { container } = render(<Harness category="music" venues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a labelled group when it does render', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Filter by venue' })).toBeInTheDocument();
  });
});

describe('venue selection state (GOI-76 §5)', () => {
  // Losing the selection on every tab switch is what makes a filter bar feel
  // hostile.
  it('remembers a selection per category', () => {
    let sel: VenueSelection = {};
    sel = withSelection(sel, 'cinema', ['a', 'b']);
    sel = withSelection(sel, 'theatre', ['c']);

    expect(selectionFor(sel, 'cinema')).toEqual(['a', 'b']);
    expect(selectionFor(sel, 'theatre')).toEqual(['c']);
    // Switching away and back keeps both.
    expect(selectionFor(sel, 'cinema')).toEqual(['a', 'b']);
  });

  it('treats an empty selection as "All" by dropping the key', () => {
    const sel = withSelection({ cinema: ['a'] }, 'cinema', []);
    expect(sel).toEqual({});
    expect(selectionFor(sel, 'cinema')).toEqual([]);
  });

  it('keys the ALL tab separately from a named category', () => {
    const sel = withSelection({}, null, ['a']);
    expect(selectionFor(sel, null)).toEqual(['a']);
    expect(selectionFor(sel, 'cinema')).toEqual([]);
  });
});

describe('URL round-trip (GOI-76 §5)', () => {
  it('serializes to slugs, not UUIDs', () => {
    expect(selectionToSlugs([MURANOW.id, ILUZJON.id], ALL_FOUR)).toEqual(['muranow', 'iluzjon']);
  });

  it('restores a selection from the URL', () => {
    const ids = slugsToSelection(parseSlugParam('muranow,iluzjon'), ALL_FOUR);
    expect(ids).toEqual([MURANOW.id, ILUZJON.id]);
  });

  // A link shared last month should open the page it mostly meant.
  it('drops unknown slugs silently rather than erroring', () => {
    expect(slugsToSelection(parseSlugParam('muranow,gone-away'), ALL_FOUR)).toEqual([MURANOW.id]);
    expect(slugsToSelection(parseSlugParam('nothing-here'), ALL_FOUR)).toEqual([]);
  });

  it('tolerates whitespace and an empty parameter', () => {
    expect(parseSlugParam(null)).toEqual([]);
    expect(parseSlugParam('')).toEqual([]);
    expect(slugsToSelection(parseSlugParam(' muranow , iluzjon '), ALL_FOUR))
      .toEqual([MURANOW.id, ILUZJON.id]);
  });
});

describe('counts ignore the selection (GOI-76 §2 — the regression that matters)', () => {
  const countsOf = () =>
    screen.getAllByRole('button').slice(1).map((b) => b.getAttribute('aria-label'));

  // The easy bug: apply the venue filter before counting, and every
  // unselected venue reads 0 the moment anything is picked — the row destroys
  // its own usefulness on first use. The component is handed counts it must
  // not reinterpret, and `filterOptions` cannot even receive a selection.
  it('leaves every other venue’s count untouched when one is selected', () => {
    const { rerender } = render(
      <VenueBar venues={ALL_FOUR} selected={[]} onChange={vi.fn()} category="cinema" />,
    );
    const before = countsOf();

    rerender(
      <VenueBar venues={ALL_FOUR} selected={[MURANOW.id]} onChange={vi.fn()} category="cinema" />,
    );
    expect(countsOf()).toEqual(before);
    expect(chip(/^Kinoteka, 8 events/)).toBeInTheDocument();
    expect(chip(/^Iluzjon, 5 events/)).toBeInTheDocument();
  });

  it('keeps the "All venues" total at the unfiltered sum while a subset is on', () => {
    render(<Harness initial={[MURANOW.id]} />);
    expect(within(chip(/^All venues/)).getByText('25')).toBeInTheDocument();
  });
});

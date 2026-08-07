import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { Category } from '@afisz/shared';
import { CategorySwatch } from './CategorySwatch';

const ALL: Category[] = ['cinema', 'theatre', 'comedy', 'music', 'exhibition', 'other'];

function swatch(category: Category, props: Partial<{ size: number; inverted: boolean }> = {}) {
  const { container } = render(<CategorySwatch category={category} {...props} />);
  return container.querySelector('svg')!;
}

// GOI-56: these were abstract shapes — a diamond for cinema, a disc for
// theatre — which said nothing about the category they marked.
describe('CategorySwatch', () => {
  it('draws a distinct mark for every category', () => {
    const drawings = ALL.map((c) => swatch(c).innerHTML);
    expect(new Set(drawings).size).toBe(ALL.length);
    expect(drawings.every((d) => d.length > 0)).toBe(true);
  });

  // The same mark has to hold at 12px in a chip and at 20px beside a title, so
  // it scales by viewBox rather than by swapping drawings.
  it('scales without redrawing', () => {
    const small = swatch('cinema', { size: 12 });
    const large = swatch('cinema', { size: 20 });

    expect(small.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(small.innerHTML).toBe(large.innerHTML);
    expect(small.getAttribute('width')).toBe('12');
    expect(large.getAttribute('width')).toBe('20');
  });

  it('keeps the palette rhythm — accent for theatre and museums, ink for the rest', () => {
    expect(swatch('theatre').getAttribute('fill')).toBe('#c62828');
    expect(swatch('exhibition').getAttribute('fill')).toBe('#c62828');
    expect(swatch('cinema').getAttribute('fill')).toBe('#141414');
    expect(swatch('comedy').getAttribute('fill')).toBe('#141414');
    expect(swatch('music').getAttribute('fill')).toBe('#141414');
  });

  // On ink or accent the two-colour palette collapses — an accent mark on an
  // accent chip is nothing at all.
  it('goes white when it sits on a filled chip', () => {
    for (const c of ALL) {
      expect(swatch(c, { inverted: true }).getAttribute('fill')).toBe('#ffffff');
    }
  });

  it('stays out of the accessibility tree — the category is always in text beside it', () => {
    const el = swatch('cinema');
    expect(el).toHaveAttribute('aria-hidden');
    expect(el).toHaveAttribute('focusable', 'false');
    expect(el).toHaveAttribute('data-category', 'cinema');
  });
});

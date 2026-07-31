import type { CSSProperties } from 'react';
import type { Category } from '@afisz/shared';
import { ACCENT, INK, PANEL } from '../lib/tokens';

/**
 * The abstract geometric marker that stands in for a category — a diamond for
 * cinema, a red disc for theatre, a hollow square for comedy, and so on.
 *
 * Deliberately never a pictogram: the poster system says "shape, not picture",
 * and the same swatch has to read at 12px in a filter chip and at 20px beside
 * a venue name. Drawn with clip-path/border-radius rather than an asset, so
 * there is nothing to load and nothing to keep in sync.
 *
 * Purely decorative — every place it appears also carries the category in
 * text, so it stays out of the accessibility tree.
 */
const SHAPES: Record<Category, CSSProperties> = {
  cinema: { background: INK, clipPath: 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)' },
  theatre: { background: ACCENT, borderRadius: '50%' },
  comedy: { background: PANEL, border: `2px solid ${INK}` },
  music: { background: INK, borderRadius: '0 50% 0 50%' },
  exhibition: { background: ACCENT, clipPath: 'polygon(20% 0,80% 0,100% 100%,0 100%)' },
  other: { background: INK },
};

export function CategorySwatch({
  category,
  size = 14,
  className,
}: {
  category: Category;
  /** Edge length in px. 12–14 in chips, 16–20 beside a title. */
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size, ...SHAPES[category] }}
    />
  );
}

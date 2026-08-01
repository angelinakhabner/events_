import type { CSSProperties } from 'react';
import type { Category } from '@afisz/shared';
import { ACCENT, INK, PANEL, WHITE } from '../lib/tokens';

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
const DIAMOND = 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)';
const TRAPEZOID = 'polygon(20% 0,80% 0,100% 100%,0 100%)';

const SHAPES: Record<Category, CSSProperties> = {
  cinema: { background: INK, clipPath: DIAMOND },
  theatre: { background: ACCENT, borderRadius: '50%' },
  comedy: { background: PANEL, border: `2px solid ${INK}` },
  music: { background: INK, borderRadius: '0 50% 0 50%' },
  exhibition: { background: ACCENT, clipPath: TRAPEZOID },
  other: { background: INK },
};

/**
 * The same six shapes drawn in white, for a swatch sitting on a filled chip.
 *
 * On ink or accent the two-colour palette collapses — an ink diamond on ink is
 * nothing at all, and an accent disc on accent likewise. Since the swatch is
 * "shape, not picture", the shape alone carries the identity and the fill can
 * go to a single colour without losing anything.
 */
const INVERTED: Record<Category, CSSProperties> = {
  cinema: { background: WHITE, clipPath: DIAMOND },
  theatre: { background: WHITE, borderRadius: '50%' },
  comedy: { background: 'transparent', border: `2px solid ${WHITE}` },
  music: { background: WHITE, borderRadius: '0 50% 0 50%' },
  exhibition: { background: WHITE, clipPath: TRAPEZOID },
  other: { background: WHITE },
};

export function CategorySwatch({
  category,
  size = 14,
  inverted = false,
  className,
}: {
  category: Category;
  /** Edge length in px. 12–14 in chips, 16–20 beside a title. */
  size?: number;
  /** Draw in white, for a swatch on a filled ink or accent background. */
  inverted?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-category={category}
      className={`inline-block shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size, ...(inverted ? INVERTED : SHAPES)[category] }}
    />
  );
}

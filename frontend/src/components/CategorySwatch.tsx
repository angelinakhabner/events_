import type { ReactNode } from 'react';
import type { Category } from '@afisz/shared';
import { ACCENT, INK, WHITE } from '../lib/tokens';

/**
 * The mark that stands in for a category, next to its name.
 *
 * These were abstract shapes — a diamond for cinema, a disc for theatre, a
 * hollow square for comedy — on the principle "shape, not picture". The
 * principle held up as ornament and failed at its job: nothing about a diamond
 * says cinema, so the mark was decoration you had to read the label to decode,
 * which is the opposite of what a marker is for (GOI-56).
 *
 * So they are pictograms now, but drawn to the poster system's rules rather
 * than borrowed from an icon set: flat, one colour each, no outlines-plus-
 * fills, no rounded corners except where the subject genuinely has them (the
 * note head, the speech bubble). Ink for the everyday categories, accent red
 * for the two that punctuate the row — the same colour rhythm the abstract
 * marks had, so the category bar still reads as a designed strip.
 *
 * Everything is drawn on a 24×24 grid with heavy, few strokes, because the
 * same mark has to survive 12px in a filter chip and carry 20px beside a venue
 * name. Detail that only works large is worse than no detail.
 *
 * Purely decorative — every place it appears also carries the category in
 * text, so it stays out of the accessibility tree.
 */

/** Ink for the everyday categories, accent for the two that punctuate. */
const COLOURS: Record<Category, string> = {
  cinema: INK,
  theatre: ACCENT,
  comedy: INK,
  music: INK,
  exhibition: ACCENT,
  other: INK,
};

/**
 * A strip of film: the frame, and perforations down both edges. The silhouette
 * carries it at 12px even once the holes close up.
 */
function CinemaMark(): ReactNode {
  // Two perforated edges with the frame open between them. Drawing it as a
  // solid block with holes punched in it read as a domino, not as film.
  return (
    <path
      fillRule="evenodd"
      d="M1 3h22v6H1V3zm2.2 1.8v2.4h2.4V4.8H3.2zm5.2 0v2.4h2.4V4.8H8.4zm5.2 0v2.4h2.4V4.8h-2.4zm5.2 0v2.4h2.4V4.8h-2.4zM1 15h22v6H1v-6zm2.2 1.8v2.4h2.4v-2.4H3.2zm5.2 0v2.4h2.4v-2.4H8.4zm5.2 0v2.4h2.4v-2.4h-2.4zm5.2 0v2.4h2.4v-2.4h-2.4z"
    />
  );
}

/**
 * A stage curtain: the pelmet, and two drapes swept back from it. The gap
 * between the drapes is the stage — closing it (an earlier version put a fold
 * down the middle) turned the whole thing into an arch with legs.
 */
function TheatreMark(): ReactNode {
  return (
    <>
      <rect x="2" y="2" width="20" height="3.5" />
      <path d="M2 5.5h8c0 7-2.5 10-5 15.5H2V5.5z" />
      <path d="M22 5.5h-8c0 7 2.5 10 5 15.5h3V5.5z" />
    </>
  );
}

/** A speech bubble — the shape a joke arrives in. */
function ComedyMark(): ReactNode {
  return <path d="M2 3h20v13H9l-5 5v-5H2V3z" />;
}

/** An eighth note: head, stem, flag. */
function MusicMark(): ReactNode {
  return (
    <>
      <rect x="10" y="3" width="2.5" height="14" />
      <path d="M12.5 3c4 1 6.5 3 6.5 6.5-1.5-3-3.5-4-6.5-4.5V3z" />
      <ellipse cx="7.5" cy="18" rx="5" ry="3.5" />
    </>
  );
}

/** A museum front: pediment, columns, steps. */
function ExhibitionMark(): ReactNode {
  return (
    <>
      <path d="M12 2l10 5H2l10-5z" />
      <rect x="4" y="9" width="3" height="9" />
      <rect x="10.5" y="9" width="3" height="9" />
      <rect x="17" y="9" width="3" height="9" />
      <rect x="2" y="19.5" width="20" height="2.5" />
    </>
  );
}

/** Nothing in particular — the abstract square the others used to be. */
function OtherMark(): ReactNode {
  return <rect x="3" y="3" width="18" height="18" />;
}

const MARKS: Record<Category, () => ReactNode> = {
  cinema: CinemaMark,
  theatre: TheatreMark,
  comedy: ComedyMark,
  music: MusicMark,
  exhibition: ExhibitionMark,
  other: OtherMark,
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
  /** Draw in white, for a mark on a filled ink or accent background. */
  inverted?: boolean;
  className?: string;
}) {
  const Mark = MARKS[category] ?? OtherMark;
  return (
    <svg
      aria-hidden
      focusable="false"
      data-category={category}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      // On ink or accent the two-colour palette collapses — an ink mark on ink
      // is nothing at all — so an inverted mark goes to white. The drawing
      // carries the identity either way.
      fill={inverted ? WHITE : (COLOURS[category] ?? INK)}
      className={`inline-block shrink-0 ${className ?? ''}`}
    >
      <Mark />
    </svg>
  );
}

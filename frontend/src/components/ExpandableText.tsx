import { useLayoutEffect, useRef, useState } from 'react';

interface Props {
  text: string;
  /** Lines to show before clamping. Both literals must appear so Tailwind keeps them. */
  clampLines?: 2 | 3;
  /** Wrapper class (e.g. spacing) applied around the paragraph + toggle. */
  className?: string;
}

const CLAMP_CLASS: Record<number, string> = {
  2: 'line-clamp-2',
  3: 'line-clamp-3',
};

/**
 * A paragraph that clamps to `clampLines` and reveals a "Read more" toggle —
 * but only when the text is actually long enough to be cut off. We measure
 * scrollHeight vs clientHeight in a layout effect (before paint, so no flash)
 * so short descriptions render with no dangling button.
 */
export function ExpandableText({ text, clampLines = 2, className }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    // Only measure while clamped — once expanded there's nothing to detect, and
    // we want `overflowing` to retain the value it had when collapsed.
    if (!el || expanded) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1); // +1 absorbs sub-pixel rounding
  }, [text, expanded]);

  return (
    <div className={className}>
      <p
        ref={ref}
        className={`text-sm text-ink/70 max-w-prose ${expanded ? '' : CLAMP_CLASS[clampLines]}`}
      >
        {text}
      </p>
      {overflowing ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-accent hover:underline"
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      ) : null}
    </div>
  );
}

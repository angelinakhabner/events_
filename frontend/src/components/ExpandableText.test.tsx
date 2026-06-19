import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpandableText } from './ExpandableText';

// jsdom reports 0 for scrollHeight/clientHeight, so simulate a clamped element
// by overriding the prototype getters for the duration of a test.
function stubOverflow(scrollHeight: number, clientHeight: number) {
  const sh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  const ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => clientHeight });
  return () => {
    if (sh) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', sh);
    if (ch) Object.defineProperty(HTMLElement.prototype, 'clientHeight', ch);
  };
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('ExpandableText', () => {
  it('shows no toggle when the text fits (not clamped)', () => {
    // jsdom default: scrollHeight === clientHeight === 0 → not overflowing.
    render(<ExpandableText text="short blurb" />);
    expect(screen.getByText('short blurb')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('reveals "Read more" only when the text overflows the clamp', () => {
    restore = stubOverflow(120, 40);
    render(<ExpandableText text="a very long description that gets clamped" />);
    expect(screen.getByRole('button', { name: /read more/i })).toBeInTheDocument();
  });

  it('toggles between clamped and full text, updating label + aria-expanded', async () => {
    restore = stubOverflow(120, 40);
    const { container } = render(<ExpandableText text="long text here" />);
    const para = container.querySelector('p')!;

    // Collapsed: clamped and labelled "Read more".
    expect(para.className).toMatch(/line-clamp-2/);
    const button = screen.getByRole('button', { name: /read more/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(button);

    // Expanded: clamp removed, label flips, aria-expanded true.
    expect(para.className).not.toMatch(/line-clamp/);
    const collapse = screen.getByRole('button', { name: /show less/i });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(collapse);
    expect(screen.getByRole('button', { name: /read more/i })).toBeInTheDocument();
  });

  it('respects a custom clamp depth', () => {
    restore = stubOverflow(120, 40);
    const { container } = render(<ExpandableText text="clamp me to three" clampLines={3} />);
    expect(container.querySelector('p')!.className).toMatch(/line-clamp-3/);
  });
});

/**
 * GOI-114: the intro block gives the listing room.
 *
 * jsdom has no layout, so this cannot measure pixels — what it can do is hold
 * the decisions the height rests on, which is where a later change would
 * quietly undo it: type sized against the viewport's *height* rather than only
 * its width, and a banner description that is cut rather than wrapped.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Festival } from '@afisz/shared';
import { FestivalBanner } from './FestivalBanner';

const NOW = new Date('2026-09-01T10:00:00Z');

const festival: Festival = {
  id: 'f1',
  name: 'Festiwal Skrzyżowanie Kultur',
  url: 'https://estrada.example',
  category: 'theatre',
  venues: ['Teatr Dramatyczny'],
  city: 'Warsaw',
  startDate: '2026-09-03',
  endDate: '2026-09-06',
  description:
    'A very long description that would otherwise wrap onto three or four lines '
    + 'and push the listing further down the page than the banner is worth.',
  status: 'upcoming',
  imageUrl: null,
};

describe('the festival banner keeps its height down (GOI-114)', () => {
  it('cuts the description to one line instead of wrapping it', () => {
    render(<FestivalBanner festivals={[festival]} now={NOW} />);
    const blurb = screen.getByText(/a very long description/i);
    expect(blurb.className).toContain('truncate');
  });

  it('sizes the festival name against the viewport height as well as its width', () => {
    render(<FestivalBanner festivals={[festival]} now={NOW} />);
    const name = screen.getByRole('heading', { name: festival.name });
    // `vw` alone says nothing about how much of the *screen* this takes, which
    // is the promise being kept — and a short laptop screen is where it was
    // worst.
    expect(name.getAttribute('style')).toContain('vh');
  });

  it('still shows every festival that earned a banner', () => {
    const second: Festival = { ...festival, id: 'f2', name: 'Drugi Festiwal' };
    render(<FestivalBanner festivals={[festival, second]} now={NOW} />);
    expect(screen.getAllByRole('heading')).toHaveLength(2);
  });
});

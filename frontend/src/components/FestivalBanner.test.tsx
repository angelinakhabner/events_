/**
 * GOI-99: a festival at the top of the page, not at the foot of it.
 *
 * The window (`bannerFestivals`) is tested against the clock in the backend
 * workspace; what is checked here is the part that only exists in the browser
 * — what the banner says, and what it does when the artwork it was given is
 * not there any more.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Festival } from '@afisz/shared';
import { FestivalBanner } from './FestivalBanner';

const NOW = new Date('2026-09-01T10:00:00Z');

function fest(over: Partial<Festival> = {}): Festival {
  return {
    id: 'skrzyzowanie',
    name: 'Festiwal Skrzyżowanie Kultur',
    url: 'https://estrada.com.pl/skrzyzowanie_kultur/',
    category: 'theatre',
    venues: ['Teatr Dramatyczny'],
    city: 'Warsaw',
    startDate: '2026-09-11',
    endDate: '2026-09-13',
    description: 'World music and stage work from across the map.',
    status: 'upcoming',
    imageUrl: null,
    ...over,
  };
}

describe('FestivalBanner', () => {
  it('announces a festival opening inside the fortnight', () => {
    render(<FestivalBanner festivals={[fest()]} now={NOW} />);
    expect(screen.getByRole('heading', { name: /skrzyżowanie kultur/i })).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByText(/^11–13 Sept?$/)).toBeInTheDocument();
    expect(screen.getByText('Teatr Dramatyczny')).toBeInTheDocument();
  });

  it('says "Now on" for one already running', () => {
    render(
      <FestivalBanner
        festivals={[fest({ status: 'ongoing', startDate: '2026-08-30', endDate: '2026-09-04' })]}
        now={NOW}
      />,
    );
    expect(screen.getByText('Now on')).toBeInTheDocument();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
  });

  it('links to the festival\'s own site, opened away from the listing', () => {
    render(<FestivalBanner festivals={[fest()]} now={NOW} />);
    const link = screen.getByRole('link', { name: /skrzyżowanie kultur/i });
    expect(link).toHaveAttribute('href', 'https://estrada.com.pl/skrzyzowanie_kultur/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  /**
   * GOI-109. This banner shipped pointing at `skrzyzowaniekultur.pl`, which
   * has no DNS record — the obvious domain for the festival, and not its
   * site. Clicking the masthead got "Safari can't find the server". So a
   * festival whose site we haven't verified carries no link at all: the
   * announcement is still worth making, and a dead link is not part of it.
   */
  describe('a festival with no verified site', () => {
    it('still announces it, in full', () => {
      render(<FestivalBanner festivals={[fest({ url: null })]} now={NOW} />);
      expect(screen.getByRole('heading', { name: /skrzyżowanie kultur/i })).toBeInTheDocument();
      expect(screen.getByText('Coming soon')).toBeInTheDocument();
      expect(screen.getByText('Teatr Dramatyczny')).toBeInTheDocument();
      expect(screen.getByText(/world music and stage work/i)).toBeInTheDocument();
    });

    it('offers nothing to click, and no "Festival site" to click it with', () => {
      render(<FestivalBanner festivals={[fest({ url: null })]} now={NOW} />);
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByText(/festival site/i)).toBeNull();
    });

    it('keeps the artwork when there is some — only the link goes', () => {
      render(
        <FestivalBanner
          festivals={[fest({ url: null, imageUrl: 'https://example.com/poster.jpg' })]}
          now={NOW}
        />,
      );
      expect(document.querySelector('img')).toHaveAttribute('src', 'https://example.com/poster.jpg');
      expect(screen.queryByRole('link')).toBeNull();
    });
  });

  // Nothing to announce is not an empty banner — it is no banner. An empty
  // ink band across the masthead is worse than the gap it fills.
  it('renders nothing when no festival is near', () => {
    const { container } = render(
      <FestivalBanner
        festivals={[fest({ startDate: '2026-11-11', endDate: '2026-11-18' })]}
        now={NOW}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before the festivals have loaded', () => {
    const { container } = render(<FestivalBanner festivals={undefined} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  describe('the artwork', () => {
    it('shows the festival\'s own banner when there is one', () => {
      render(
        <FestivalBanner
          festivals={[fest({ imageUrl: 'https://example.com/banner.jpg' })]}
          now={NOW}
        />,
      );
      const img = document.querySelector('img')!;
      expect(img).toHaveAttribute('src', 'https://example.com/banner.jpg');
      // Decorative: the name is set beside it in text, so an alt would be the
      // same sentence read twice.
      expect(img).toHaveAttribute('alt', '');
    });

    it('sets the name in type when there is none', () => {
      render(<FestivalBanner festivals={[fest()]} now={NOW} />);
      expect(document.querySelector('img')).toBeNull();
      expect(screen.getByRole('heading', { name: /skrzyżowanie kultur/i })).toBeInTheDocument();
    });

    /**
     * The URLs are copied by hand from festival sites, which reorganise
     * between editions. A dead one must degrade to the typographic banner,
     * not leave a broken-image glyph across the top of the home page.
     */
    it('falls back to type when the image fails to load', () => {
      render(
        <FestivalBanner festivals={[fest({ imageUrl: 'https://example.com/gone.jpg' })]} now={NOW} />,
      );
      fireEvent.error(document.querySelector('img')!);
      expect(document.querySelector('img')).toBeNull();
      expect(screen.getByRole('heading', { name: /skrzyżowanie kultur/i })).toBeInTheDocument();
    });
  });

  /** On /my the festival is annotated with the reader's own venue names,
   *  including a personal rename (GOI-33). */
  it('prefers the reader\'s own name for the venue', () => {
    const mine = { ...fest(), yourVenues: ['Dramatyczny (mój)'] };
    render(<FestivalBanner festivals={[mine]} now={NOW} label="Festivals at your venues" />);
    expect(screen.getByText('Dramatyczny (mój)')).toBeInTheDocument();
    expect(screen.queryByText('Teatr Dramatyczny')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Festivals at your venues' })).toBeInTheDocument();
  });

  it('shows the soonest first when two are near', () => {
    const later = fest({ id: 'a', name: 'Later Fest', startDate: '2026-09-12' });
    const sooner = fest({ id: 'b', name: 'Sooner Fest', startDate: '2026-09-03', endDate: '2026-09-06' });
    render(<FestivalBanner festivals={[later, sooner]} now={NOW} />);
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['Sooner Fest', 'Later Fest']);
  });
});

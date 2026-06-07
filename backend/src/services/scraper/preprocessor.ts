import * as cheerio from 'cheerio';
import type { Venue } from '@goin/shared';

export interface PreprocessResult {
  cleaned: string;
  /** Optional structured hint surfaced to the extractor (e.g. month/year label). */
  hint: string | null;
  usedFallback: boolean;
}

export function preprocessForVenue(html: string, venue: Pick<Venue, 'id'>): PreprocessResult {
  switch (venue.id) {
    case 'kino-muranow':
      return preprocessMuranow(html);
    default:
      return preprocessGeneric(html);
  }
}

function preprocessMuranow(html: string): PreprocessResult {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, link').remove();

  const root = $('#calendar-wrapper').first();
  if (!root.length || root.text().trim().length === 0) {
    console.warn('[preprocessor] kino-muranow: #calendar-wrapper not found, falling back to full body');
    return preprocessGeneric(html);
  }

  // Strip the expanded details pane on each screening (keeps title link via cycles).
  // We retain the inner film URL by promoting it onto the outer .movie-calendar-info
  // before stripping the expand pane.
  root.find('.movie-calendar-info').each((_, el) => {
    const $el = $(el);
    const expand = $el.find('.movie-calendar-info-expand').first();
    if (expand.length) {
      const filmLink = expand.find('a.movie-calendar-info-expand__thumb').attr('href')
        || expand.find('a.c-button-tickets--movie-link').attr('href')
        || null;
      if (filmLink) {
        $el.attr('data-film-url', filmLink);
      }
      expand.remove();
    }
    $el.find('img').remove();
  });

  // Strip noisy attributes that don't help the model.
  root.find('*').each((_, el) => {
    if (el.type !== 'tag') return;
    for (const attr of Object.keys(el.attribs)) {
      if (attr.startsWith('data-drupal') || attr === 'data-once' || attr === 'data-toggle' || attr === 'data-parent' || attr === 'role' || attr === 'aria-hidden') {
        $(el).removeAttr(attr);
      }
    }
  });

  const monthLabel = root.find('.calendar-seance-full__month-label').first().text().trim();
  const cleaned = root.html() ?? '';
  return {
    cleaned,
    hint: monthLabel ? `Calendar month label: "${monthLabel}"` : null,
    usedFallback: false,
  };
}

function preprocessGeneric(html: string): PreprocessResult {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, link, head, nav, footer').remove();
  const body = $('body').html() ?? html;
  return { cleaned: body, hint: null, usedFallback: true };
}

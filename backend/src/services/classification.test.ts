import { describe, it, expect } from 'vitest';
import {
  CONTENT_CATEGORIES,
  classifyAudience,
  classifyByKeyword,
  classifyEvent,
  isContentCategory,
  keepKnownCategories,
  upcomingSummary,
} from '@afisz/shared';
import { parseReply } from './scraper/describer.js';

/**
 * Event classification (GOI-80). The keyword pass is deterministic and the
 * structure is authoritative — those two properties are what the tests are
 * actually protecting.
 */

describe('keyword pass — title only, Polish stems', () => {
  it.each([
    ['Oprowadzanie kuratorskie po wystawie X', 'guided_tour'],
    ['Oprowadzenie po ekspozycji', 'guided_tour'],
    ['Spacer po parku rzeźby', 'guided_tour'],
    ['Warsztaty ceramiczne', 'workshop'],
    ['Warsztat pisania', 'workshop'],
    ['Pokaz filmu dokumentalnego', 'screening'],
    ['Projekcja: Ojczyzna', 'screening'],
    ['Seans o północy', 'screening'],
    ['Wykład o sztuce', 'lecture'],
    ['Spotkanie z autorem', 'lecture'],
    ['Debata o mieście', 'lecture'],
    ['Koncert jazzowy', 'concert'],
    ['Spektakl: Wesele', 'performance'],
    ['Performans w foyer', 'performance'],
    ['Wystawa stała', 'exhibition'],
  ] as const)('reads %s as %s', (title, expected) => {
    expect(classifyByKeyword(title)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(classifyByKeyword('KONCERT NOWOROCZNY')).toBe('concert');
  });

  // The order in the table is the tie-break, and it is part of the contract.
  it('resolves a title matching two keywords by documented first-match order', () => {
    // Both "oprowadzanie" and "wystawie" are present; guided_tour is first.
    expect(classifyByKeyword('Oprowadzanie po wystawie')).toBe('guided_tour');
    // Both "warsztat" and "koncert"; workshop is first.
    expect(classifyByKeyword('Warsztaty przed koncertem')).toBe('workshop');
  });

  it('returns null when nothing matches, leaving the row for the model', () => {
    expect(classifyByKeyword('Zupełnie nowy tytuł')).toBeNull();
    expect(classifyByKeyword('')).toBeNull();
  });
});

describe('audience — independent of category (GOI-80 Field 3)', () => {
  it.each([
    'Warsztaty rodzinne: ceramika',
    'Zajęcia dla dzieci',
    'Spotkanie dla rodzin',
    'Wystawa dla najmłodszych',
  ])('reads %s as family', (title) => {
    expect(classifyAudience(title)).toBe('family');
  });

  it('is null otherwise', () => {
    expect(classifyAudience('Koncert jazzowy')).toBeNull();
  });

  // Folding family into the category vocabulary would swallow the workshop
  // signal — this is the bug the separate field exists to prevent.
  it('sets both workshop and family, not one or the other', () => {
    const c = classifyEvent({ title: 'Warsztaty rodzinne: ceramika', isExhibitionShape: false });
    expect(c.contentCategory).toBe('workshop');
    expect(c.audience).toBe('family');
  });
});

describe('structure wins (GOI-80 Field 1)', () => {
  it('classifies a run as an exhibition without a keyword or model pass', () => {
    const c = classifyEvent({ title: 'Cokolwiek', isExhibitionShape: true });
    expect(c).toMatchObject({
      contentCategory: 'exhibition',
      categorySource: 'structural',
      conflict: null,
    });
  });

  // The temporal shape selects the date predicate at query time. Getting it
  // from a guess would break date filtering, not merely mislabel a chip.
  it('keeps the structural answer when the model disagrees, and logs the conflict', () => {
    const c = classifyEvent({
      title: 'Koncert w muzeum',
      isExhibitionShape: true,
      llmCategory: 'concert',
    });
    expect(c.contentCategory).toBe('exhibition');
    expect(c.categorySource).toBe('structural');
    expect(c.conflict).toMatch(/structure says exhibition/i);
  });

  it('does not report a conflict when the model agrees', () => {
    const c = classifyEvent({
      title: 'Wystawa', isExhibitionShape: true, llmCategory: 'exhibition',
    });
    expect(c.conflict).toBeNull();
  });
});

describe('model path', () => {
  it('is only reached when the keyword pass found nothing', () => {
    const c = classifyEvent({
      title: 'Koncert jazzowy', isExhibitionShape: false, llmCategory: 'lecture',
    });
    // The keyword won; the model's answer is not consulted.
    expect(c).toMatchObject({ contentCategory: 'concert', categorySource: 'keyword' });
  });

  it('accepts a value inside the vocabulary', () => {
    const c = classifyEvent({
      title: 'Nieznany tytuł', isExhibitionShape: false, llmCategory: 'lecture',
    });
    expect(c).toMatchObject({ contentCategory: 'lecture', categorySource: 'llm', conflict: null });
  });

  // The vocabulary is a contract with saved filters, so nothing outside it
  // may enter the set.
  it('coerces a value outside the vocabulary to "other" and says so', () => {
    const c = classifyEvent({
      title: 'Nieznany tytuł', isExhibitionShape: false, llmCategory: 'vernissage',
    });
    expect(c.contentCategory).toBe('other');
    expect(c.categorySource).toBe('llm');
    expect(c.conflict).toMatch(/outside the vocabulary/i);
  });

  it('falls back to "other" when there is no model answer either', () => {
    const c = classifyEvent({ title: 'Nieznany tytuł', isExhibitionShape: false });
    expect(c.contentCategory).toBe('other');
  });
});

describe('persistence contract', () => {
  it('keeps every known value and drops the rest, without throwing', () => {
    expect(keepKnownCategories(['workshop', 'vernissage', 'concert']))
      .toEqual(['workshop', 'concert']);
  });

  it('survives junk in a saved filter', () => {
    expect(keepKnownCategories(null)).toEqual([]);
    expect(keepKnownCategories('workshop')).toEqual([]);
    expect(keepKnownCategories([1, null, undefined, {}])).toEqual([]);
  });

  it('recognises exactly the documented vocabulary', () => {
    expect(CONTENT_CATEGORIES).toHaveLength(9);
    for (const c of CONTENT_CATEGORIES) expect(isContentCategory(c)).toBe(true);
    expect(isContentCategory('vernissage')).toBe(false);
  });
});

// ─── The reply the classification rides on (GOI-80 step 2) ───────────────────

describe('describer reply parsing', () => {
  it('splits the two labelled lines', () => {
    const r = parseReply('CATEGORY: workshop\nDESCRIPTION: Warsztaty ceramiczne dla początkujących.');
    expect(r).toEqual({
      category: 'workshop',
      description: 'Warsztaty ceramiczne dla początkujących.',
    });
  });

  it('lower-cases and trims the category', () => {
    expect(parseReply('CATEGORY:  Concert \nDESCRIPTION: x').category).toBe('concert');
  });

  it('reads NONE as no description while keeping the category', () => {
    const r = parseReply('CATEGORY: lecture\nDESCRIPTION: NONE');
    expect(r).toEqual({ category: 'lecture', description: null });
  });

  // A model that ignores the format still has to yield something usable.
  it('treats an unlabelled reply as the description, as the old prompt produced', () => {
    const r = parseReply('Spektakl o rodzinie.');
    expect(r).toEqual({ category: null, description: 'Spektakl o rodzinie.' });
  });

  it('survives a missing category line', () => {
    expect(parseReply('DESCRIPTION: Koncert w piwnicy.')).toEqual({
      category: null,
      description: 'Koncert w piwnicy.',
    });
  });

  it('keeps a multi-line description whole', () => {
    const r = parseReply('CATEGORY: other\nDESCRIPTION: Pierwsze zdanie.\nDrugie zdanie.');
    expect(r.description).toBe('Pierwsze zdanie. Drugie zdanie.');
  });
});

// ─── The venue list's split count (GOI-80 UI) ────────────────────────────────

describe('upcomingSummary', () => {
  // "69 upcoming" at a museum is mostly one three-month run and dozens of
  // tours; the single figure says neither.
  it('splits runs from showtimes', () => {
    expect(upcomingSummary(69, 6)).toBe('6 exhibitions · 63 events');
  });

  it('drops the half that is zero', () => {
    expect(upcomingSummary(63, 0)).toBe('63 events');
    expect(upcomingSummary(6, 6)).toBe('6 exhibitions');
  });

  it('reads correctly in the singular', () => {
    expect(upcomingSummary(2, 1)).toBe('1 exhibition · 1 event');
  });

  it('says "0 events" rather than nothing at all', () => {
    expect(upcomingSummary(0, 0)).toBe('0 events');
  });

  // A count that outran its total would otherwise print a negative.
  it('never reports more runs than there are events', () => {
    expect(upcomingSummary(3, 9)).toBe('3 exhibitions');
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { Event } from '@afisz/shared';
import { inviteText, shareEvent } from './share';
import { DEFAULT_SHARE_TEMPLATE } from '@afisz/shared';

const event = {
  title: 'Perfect Days',
  sourceUrl: 'https://kinomuranow.pl/film/perfect-days',
  venue: { id: 'v-1', name: 'Kino Muranów', category: 'cinema' as const, city: 'Warsaw', country: 'PL' },
  category: 'cinema' as const,
  // 18:00Z is 20:00 in Warsaw in July.
  startsAt: '2026-07-04T18:00:00.000Z',
} satisfies Pick<Event, 'title' | 'sourceUrl' | 'venue' | 'category' | 'startsAt'>;

/** The invitation for the fixture above, as every expectation below spells it.
 *  Kept as a regex around the month so a newer ICU ("Jul" vs "Jul.") can't
 *  fail the test on wording that isn't under test. */
const INVITE = /^Darling, let's go to Perfect Days at Kino Muranów together — Sat 4 Jul\w*, 20:00$/;

describe('shareEvent', () => {
  it('uses the injected share() and reports "shared" on success', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const r = await shareEvent(event, { share });
    expect(r).toBe('shared');
    expect(share).toHaveBeenCalledWith({
      title: 'Perfect Days',
      text: expect.stringMatching(INVITE),
      url: 'https://kinomuranow.pl/film/perfect-days',
    });
  });

  it('reports "cancelled" when share() throws an AbortError (user closed the sheet)', async () => {
    const abort = Object.assign(new Error('user aborted'), { name: 'AbortError' });
    const share = vi.fn().mockRejectedValue(abort);
    const writeText = vi.fn(); // must NOT be called on cancel
    const r = await shareEvent(event, { share, writeText });
    expect(r).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to clipboard when share() is missing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const r = await shareEvent(event, { writeText });
    expect(r).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Darling, let's go to Perfect Days at Kino Muranów together — Sat 4 Jul\w*, 20:00\nhttps:\/\/kinomuranow\.pl\/film\/perfect-days$/,
      ),
    );
  });

  it('falls back to clipboard when share() rejects with NotAllowedError', async () => {
    const notAllowed = Object.assign(new Error('not from gesture'), { name: 'NotAllowedError' });
    const share = vi.fn().mockRejectedValue(notAllowed);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const r = await shareEvent(event, { share, writeText });
    expect(r).toBe('copied');
    expect(writeText).toHaveBeenCalled();
  });

  it('reports "failed" when neither share nor clipboard is available', async () => {
    expect(await shareEvent(event, {})).toBe('failed');
  });

  it('reports "failed" when clipboard write throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    expect(await shareEvent(event, { writeText })).toBe('failed');
  });

  it('omits the venue clause when no venue is attached', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    await shareEvent({ ...event, venue: undefined }, { share });
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringMatching(/^Darling, let's go to Perfect Days together — Sat 4 Jul/),
      }),
    );
  });
});

// GOI-49: sharing an event is an invitation, not a citation. The recipient
// should be able to answer yes without opening the link.
describe('inviteText', () => {
  it('names the thing, the place and the time in one sentence', () => {
    expect(inviteText(event)).toMatch(INVITE);
  });

  it('gives a museum the day without an hour', () => {
    // Museums publish runs; their undated rows carry a placeholder midnight
    // that would read as an invitation to meet at midnight (GOI-53).
    const museum = {
      ...event,
      title: 'Wystawa stała',
      category: 'exhibition' as const,
      venue: { ...event.venue, name: 'Muzeum Narodowe', category: 'exhibition' as const },
      startsAt: '2026-07-04T22:00:00.000Z', // 00:00 Warsaw on the 5th
    };
    const text = inviteText(museum);
    expect(text).toMatch(/^Darling, let's go to Wystawa stała at Muzeum Narodowe together — Sun 5 Jul/);
    expect(text).not.toMatch(/00:00/);
    expect(text).not.toMatch(/All day/);
  });

  it('keeps a museum\'s real hour when the listing published one', () => {
    const tour = {
      ...event,
      title: 'Oprowadzanie',
      category: 'exhibition' as const,
      startsAt: '2026-07-04T09:00:00.000Z', // 11:00 Warsaw
    };
    expect(inviteText(tour)).toMatch(/together — Sat 4 Jul\w*, 11:00$/);
  });

  it('drops the when entirely for something with no usable date', () => {
    // A tracked film is a title and nothing else — `filmAsEvent` gives it an
    // empty startsAt.
    expect(inviteText({ ...event, startsAt: '' })).toBe(
      "Darling, let's go to Perfect Days at Kino Muranów together",
    );
  });
});

// GOI-49 follow-up: the wording belongs to the reader — it gets pasted into
// someone else's chat under their name, so the default is only a default.
describe('inviteText — custom template', () => {
  it('uses a saved template in place of the default', () => {
    expect(inviteText(event, 'Fancy {title}{venue}?{when}')).toMatch(
      /^Fancy Perfect Days at Kino Muranów\? — Sat 4 Jul/,
    );
  });

  it('drops the venue and the when cleanly when the event has neither', () => {
    // The placeholders carry their own " at " and " — ", so nothing is left
    // dangling — the whole point of substituting phrases rather than values.
    const bare = { ...event, venue: undefined, startsAt: '' };
    expect(inviteText(bare, DEFAULT_SHARE_TEMPLATE)).toBe(
      "Darling, let's go to Perfect Days together",
    );
    expect(inviteText(bare, 'Fancy {title}{venue}?{when}')).toBe('Fancy Perfect Days?');
  });

  it('leaves an unknown placeholder visible rather than swallowing it', () => {
    // A typo should show up in the settings preview as itself.
    expect(inviteText(event, 'Go to {titel}')).toBe('Go to {titel}');
  });

  it('repeats a placeholder used more than once', () => {
    expect(inviteText(event, '{title} — {title}')).toBe('Perfect Days — Perfect Days');
  });

  it('falls back to the default when no template is given', () => {
    expect(inviteText(event)).toBe(inviteText(event, DEFAULT_SHARE_TEMPLATE));
  });

  it('passes the template through shareEvent', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    await shareEvent(event, { share }, 'Come to {title}');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: 'Come to Perfect Days' }));
  });
});

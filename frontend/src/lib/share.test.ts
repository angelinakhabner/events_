import { describe, it, expect, vi } from 'vitest';
import type { Event } from '@goin/shared';
import { shareEvent } from './share';

const event = {
  title: 'Perfect Days',
  sourceUrl: 'https://kinomuranow.pl/film/perfect-days',
  venue: { id: 'v-1', name: 'Kino Muranów', category: 'cinema' as const, city: 'Warsaw', country: 'PL' },
} satisfies Pick<Event, 'title' | 'sourceUrl' | 'venue'>;

describe('shareEvent', () => {
  it('uses the injected share() and reports "shared" on success', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const r = await shareEvent(event, { share });
    expect(r).toBe('shared');
    expect(share).toHaveBeenCalledWith({
      title: 'Perfect Days',
      text: 'Perfect Days @ Kino Muranów',
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
      'Perfect Days @ Kino Muranów\nhttps://kinomuranow.pl/film/perfect-days',
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

  it('omits the venue suffix when no venue is attached', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    await shareEvent({ ...event, venue: undefined }, { share });
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: 'Perfect Days' }));
  });
});

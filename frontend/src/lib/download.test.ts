import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadText, slugifyForFilename } from './download';

/** Capture the synthetic anchor the helper clicks, plus the blob it points at. */
function captureDownload() {
  const clicked: { name: string; type: string; parts: unknown[] }[] = [];
  const created: string[] = [];

  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob.type);
    return 'blob:stub';
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;

  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    clicked.push({ name: this.download, type: created[created.length - 1] ?? '', parts: [] });
  };

  return {
    clicked,
    restore() {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      HTMLAnchorElement.prototype.click = origClick;
    },
  };
}

let capture: ReturnType<typeof captureDownload>;
beforeEach(() => { capture = captureDownload(); });
afterEach(() => { capture.restore(); vi.useRealTimers(); });

describe('downloadText', () => {
  it('clicks an anchor carrying the filename and MIME type', () => {
    downloadText('afisz-brief-2026-07-31.html', '<!doctype html><p>hi</p>', 'text/html');

    expect(capture.clicked).toHaveLength(1);
    expect(capture.clicked[0]!.name).toBe('afisz-brief-2026-07-31.html');
    expect(capture.clicked[0]!.type).toBe('text/html;charset=utf-8');
  });

  it('leaves nothing behind in the document', () => {
    downloadText('x.html', 'x', 'text/html');
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('revokes the blob URL, but not before the click has used it', () => {
    vi.useFakeTimers();
    downloadText('x.html', 'x', 'text/html');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stub');
  });

  // The download is always the second thing on screen — the rendered brief,
  // the calendar menu. An environment that won't mint a blob URL must not
  // take the first thing down with it.
  it('reports failure instead of throwing when blob URLs are unavailable', () => {
    const orig = URL.createObjectURL;
    // @ts-expect-error — modelling an environment that lacks the API.
    URL.createObjectURL = undefined;
    try {
      expect(downloadText('x.html', 'x', 'text/html')).toBe(false);
      expect(capture.clicked).toHaveLength(0);
    } finally {
      URL.createObjectURL = orig;
    }
  });

  // The revoke fires a second later, by which time the caller has returned and
  // the environment may have taken the API away with it — nothing is left to
  // catch a throw, so it becomes an unhandled error.
  it('survives revokeObjectURL disappearing before the timer fires', () => {
    vi.useFakeTimers();
    downloadText('x.html', 'x', 'text/html');
    // @ts-expect-error — modelling an environment that dropped the API.
    URL.revokeObjectURL = undefined;
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });

  it('reports failure instead of throwing when the click blows up', () => {
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => { throw new Error('blocked'); };
    try {
      expect(downloadText('x.html', 'x', 'text/html')).toBe(false);
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
    // The stray anchor is still cleaned up.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('reports success when the anchor was clicked', () => {
    expect(downloadText('x.html', 'x', 'text/html')).toBe(true);
  });
});

describe('slugifyForFilename', () => {
  it('folds accents and collapses everything else to dashes', () => {
    expect(slugifyForFilename('Kino Muranów: Ojczyzna!')).toBe('kino-muranow-ojczyzna');
  });

  it('falls back when a title slugifies to nothing', () => {
    expect(slugifyForFilename('！！！', 'event')).toBe('event');
  });

  it('caps the length so a long title stays a usable filename', () => {
    expect(slugifyForFilename('a'.repeat(200))).toHaveLength(60);
  });
});

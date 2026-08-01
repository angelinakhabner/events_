/**
 * Save generated text to the user's disk. Returns whether the download was
 * actually handed to the browser.
 *
 * The only way a browser offers is a blob URL behind a synthetic anchor
 * click, so this is the one place that dance lives — the .ics export and the
 * newsletter brief both go through it.
 *
 * Best-effort on purpose. Saving a file is always the *second* thing on
 * screen — the calendar menu, the rendered brief — and a blob URL the
 * environment won't mint must not take the first thing down with it. Callers
 * that want to say something can check the return; callers that don't can
 * ignore it and still render.
 */
export function downloadText(filename: string, content: string, mime: string): boolean {
  if (typeof URL?.createObjectURL !== 'function') return false;
  let url: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  try {
    url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    return true;
  } catch {
    return false;
  } finally {
    // Both cleanups belong here: a click that throws would otherwise leave the
    // anchor in the document and the blob held for the life of the page.
    anchor?.remove();
    const created = url;
    // Free the blob next tick so the click handler can use it first.
    if (created) setTimeout(() => URL.revokeObjectURL(created), 1000);
  }
}

/** Filename-safe slug: accents folded, everything else collapsed to dashes. */
export function slugifyForFilename(s: string, fallback = 'file'): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .toLowerCase()
      .slice(0, 60) || fallback
  );
}

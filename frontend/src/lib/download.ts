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
  return downloadBlob(filename, new Blob([content], { type: `${mime};charset=utf-8` }));
}

/** The blob-URL-behind-a-synthetic-anchor dance, shared by both savers. */
function downloadBlob(filename: string, blob: Blob): boolean {
  if (typeof URL?.createObjectURL !== 'function') return false;
  let url: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  try {
    url = URL.createObjectURL(blob);
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
    // Free the blob next tick so the click handler can use it first. This runs
    // long after the call returned, when nobody is left to catch a throw, and
    // the API may well be gone by then — an environment that minted the URL is
    // not obliged to still offer revoke. A blob held to the end of the page is
    // the worst case, so swallow it rather than surface an unhandled error.
    if (created) {
      setTimeout(() => {
        try {
          URL.revokeObjectURL?.(created);
        } catch {
          /* the blob outlives the page; nothing else to do */
        }
      }, 1000);
    }
  }
}

/**
 * Save base64-encoded binary — the newsletter PDF (GOI-45/GOI-91) — to disk.
 *
 * Separate from `downloadText` because the bytes have to survive the trip
 * intact: `atob` yields a binary string whose char codes are the bytes, and
 * putting that string straight into a Blob would re-encode it as UTF-8 and
 * corrupt every byte above 0x7F — which, in a PDF, is most of the font.
 * Copying through a `Uint8Array` is what keeps it a PDF.
 *
 * Best-effort in the same way and for the same reason as `downloadText`.
 */
export function downloadBase64(filename: string, base64: string, mime: string): boolean {
  if (typeof URL?.createObjectURL !== 'function') return false;
  let bytes: Uint8Array;
  try {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return false;
  }
  return downloadBlob(filename, new Blob([bytes.buffer as ArrayBuffer], { type: mime }));
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

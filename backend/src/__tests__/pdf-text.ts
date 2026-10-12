/**
 * Read a rendered PDF back as text, for tests.
 *
 * Letterspaced labels come back one glyph per text item (`W A N T   T O`), so
 * `flat` drops all whitespace; assert against it with `squash(expected)`.
 * Order is preserved, so `indexOf` still compares positions.
 */
export async function pdfText(
  pdf: Buffer,
): Promise<{ pages: string[]; flat: string; flatPages: string[]; links: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false }).promise;
  const pages: string[] = [];
  const links: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' '));
    for (const a of await page.getAnnotations()) {
      if (typeof (a as { url?: unknown }).url === 'string') links.push((a as { url: string }).url);
    }
  }
  const flatPages = pages.map(squash);
  return { pages, flat: flatPages.join('\n'), flatPages, links };
}

export const squash = (s: string) => s.replace(/\s+/g, '');

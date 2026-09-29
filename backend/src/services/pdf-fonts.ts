import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locating and loading the fonts the PDF renderers embed.
 *
 * Shared by the brief (`newsletter-pdf.ts`, DejaVu) and the daily poster
 * (`newsletter-poster-pdf.ts`, Archivo) so neither has to import the other.
 */

const FONT_REGULAR_FILE = 'DejaVuSans.subset.ttf';

/**
 * Where `backend/assets/fonts` actually is, found by walking up (GOI-96).
 *
 * It used to be `../../assets/fonts` from this module, which is right when
 * this file runs as TypeScript out of `backend/src/services` and wrong
 * everywhere else. `tsc` emits to `backend/dist/backend/src/services`, and
 * nothing copies `assets/` into `dist`, so in production that same relative
 * path pointed at `backend/dist/backend/assets/fonts` — a directory that has
 * never existed. The only symptom was the brief refusing to render, with
 * "ENOENT: no such file or directory" naming a path deep inside `dist` that
 * gives no hint the fonts are sitting unbuilt two levels above it.
 *
 * Walking up until the directory turns up is indifferent to how deep the
 * compiler nests its output, so dev, `dist`, and the test runner all resolve
 * to the one copy of the fonts in the repo instead of three guesses at it.
 */
export function resolveFontDir(startDir: string): string {
  let dir = startDir;
  // `backend/dist/backend/src/services` is five levels below `backend/`, so
  // the bound is generous rather than tight; the loop stops at the filesystem
  // root regardless.
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'assets', 'fonts');
    if (existsSync(path.join(candidate, FONT_REGULAR_FILE))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not find ${FONT_REGULAR_FILE}: no assets/fonts directory above ` +
      `${startDir}. The brief needs the embedded DejaVu subset to set Polish text.`,
  );
}


const cache = new Map<string, Uint8Array>();

/**
 * One font file's bytes from `assets/fonts`, read once per process.
 *
 * Returned as a `Uint8Array` built by *this* realm's constructor rather than
 * the `Buffer` `readFileSync` gives: fontkit sniffs the format behind an
 * `instanceof Uint8Array` check, which a Node Buffer fails under jsdom (see
 * the longer note in `newsletter-pdf.ts`).
 */
export function loadFont(file: string): Uint8Array {
  let bytes = cache.get(file);
  if (!bytes) {
    const dir = resolveFontDir(path.dirname(fileURLToPath(import.meta.url)));
    bytes = new Uint8Array(readFileSync(path.join(dir, file)));
    cache.set(file, bytes);
  }
  return bytes;
}

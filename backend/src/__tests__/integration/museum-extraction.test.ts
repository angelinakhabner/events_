/**
 * Museum extraction, end to end minus the network and the DB (GOI-67).
 *
 * A museum page lists two different things — a run over a date range and a
 * workshop at 17:30 — and until now the pipeline flattened both into "an event
 * that starts at an hour", inventing the hour for the first. This drives the
 * real preprocessor → prompt → validator → row-mapping path with the Claude
 * call mocked, and asserts the two survive as two different kinds.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Venue } from '@afisz/shared';
import { preprocessForVenue } from '../../services/scraper/preprocessor.js';
import { extractEvents, type ExtractorClient } from '../../services/scraper/extractor.js';
import { validateEvents } from '../../services/scraper/validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '../../../test/fixtures/museum-mixed.html');

const venue: Venue = {
  id: 'museum-1',
  name: 'Muzeum Przykładowe',
  url: 'https://muzeum.example/program',
  city: 'Warsaw',
  country: 'PL',
  category: 'exhibition',
  language: 'pl',
  timezone: 'Europe/Warsaw',
  createdAt: '',
};

/** What the model returns for this page once the prompt asks it to classify.
 *  Held as a fixture-shaped constant so the test exercises our pipeline, not
 *  the model's judgement. */
const MODEL_OUTPUT = JSON.stringify([
  {
    title: 'Trzy przestrzenie podziemne',
    kind: 'exhibition',
    starts_at: '2026-06-12T00:00:00+02:00',
    ends_at: '2026-09-14T00:00:00+02:00',
    duration_minutes: null,
    language: 'pl',
    director: null,
    cast: null,
    description: 'Interwencja w przestrzeni muzeum.',
    price_min: null,
    price_max: null,
    source_url: 'https://muzeum.example/wystawa/trzy-przestrzenie',
    source_id: null,
  },
  {
    title: 'Warsztaty rysunku',
    kind: 'timed',
    starts_at: '2026-06-20T17:30:00+02:00',
    ends_at: null,
    duration_minutes: 120,
    language: 'pl',
    director: null,
    cast: null,
    description: 'Warsztaty rysunku dla dorosłych.',
    price_min: null,
    price_max: null,
    source_url: 'https://muzeum.example/wydarzenie/warsztaty-rysunku',
    source_id: null,
  },
]);

async function runPipeline() {
  const html = await fs.readFile(fixturePath, 'utf-8');
  const { cleaned } = preprocessForVenue(html, venue);
  const prompts: { system: string; user: string }[] = [];
  const client: ExtractorClient = {
    extract: async ({ system, user }) => {
      prompts.push({ system, user });
      return MODEL_OUTPUT;
    },
  };
  const raw = await extractEvents(cleaned, venue, new Date('2026-06-15T08:00:00.000Z'), { client });
  const result = validateEvents(raw, { category: venue.category, timezone: venue.timezone });
  return { prompts, result };
}

describe('museum extraction (GOI-67)', () => {
  it('turns a mixed page into one exhibition row and one timed row', async () => {
    const { result } = await runPipeline();

    expect(result.invalid).toEqual([]);
    expect(result.valid).toHaveLength(2);

    const exhibition = result.valid.find((e) => e.kind === 'exhibition');
    const timed = result.valid.find((e) => e.kind === 'timed');

    expect(exhibition?.title).toBe('Trzy przestrzenie podziemne');
    expect(exhibition?.starts_at).toBe('2026-06-12T00:00:00+02:00');
    expect(exhibition?.ends_at).toBe('2026-09-14T00:00:00+02:00');

    expect(timed?.title).toBe('Warsztaty rysunku');
    expect(timed?.starts_at).toBe('2026-06-20T17:30:00+02:00');
    // A timed row must not carry a closing date — that is what makes it a
    // point in the day rather than a run.
    expect(timed?.ends_at).toBeNull();
  });

  it('the exhibition survives even though it opened before today', async () => {
    // Today in the run above is 15 June; the run opened on the 12th. The old
    // "starts in the future" reading dropped exactly these rows.
    const { result } = await runPipeline();
    const exhibition = result.valid.find((e) => e.kind === 'exhibition')!;
    expect(Date.parse(exhibition.starts_at)).toBeLessThan(Date.parse('2026-06-15T08:00:00.000Z'));
  });

  it('asks the model to classify each row, and never to invent an hour', async () => {
    const { prompts } = await runPipeline();
    expect(prompts).toHaveLength(1);
    const { user } = prompts[0]!;
    expect(user).toContain('"kind": "timed" | "exhibition"');
    expect(user).toMatch(/NEVER invent a start_time/);
    // The page's own content reached the model — i.e. the preprocessor didn't
    // strip the listing this test is about.
    expect(user).toContain('Trzy przestrzenie podziemne');
    expect(user).toContain('17:30');
  });
});

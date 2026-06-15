import { describe, it, expect } from 'vitest';
import { extractStructuredData, preprocessForVenue } from './preprocessor.js';

const JSON_LD_PAGE = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"ScreeningEvent","name":"Rozmowa","startDate":"2026-06-16T18:30:00+02:00","location":{"@type":"Place","name":"Kinoteka"}}
</script>
</head><body><div id="app"></div></body></html>`;

const GRAPH_PAGE = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"Organization","name":"Kinoteka"},
  {"@type":"TheaterEvent","name":"Osiem i pół","startDate":"2026-06-16T20:00:00+02:00"}
]}
</script></head><body>shell</body></html>`;

const NEXT_DATA_PAGE = `<html><body><div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"screenings":[{"title":"Monterey Pop","time":"21:00"}]}}}</script>
</body></html>`;

const PLAIN_PAGE = `<html><body><h1>Repertuar</h1><p>Nothing structured here</p></body></html>`;

describe('extractStructuredData', () => {
  it('extracts Event-typed JSON-LD nodes', () => {
    const out = extractStructuredData(JSON_LD_PAGE);
    expect(out).toBeTruthy();
    const parsed = JSON.parse(out!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Rozmowa');
    expect(parsed[0].startDate).toBe('2026-06-16T18:30:00+02:00');
  });

  it('flattens @graph and keeps only event-like types', () => {
    const out = extractStructuredData(GRAPH_PAGE);
    const parsed = JSON.parse(out!);
    expect(parsed.map((e: { name: string }) => e.name)).toEqual(['Osiem i pół']);
  });

  it('falls back to __NEXT_DATA__ when no JSON-LD events exist', () => {
    const out = extractStructuredData(NEXT_DATA_PAGE);
    expect(out).toContain('Monterey Pop');
  });

  it('returns null for a plain page with no structured data', () => {
    expect(extractStructuredData(PLAIN_PAGE)).toBeNull();
  });

  it('ignores malformed JSON-LD without throwing', () => {
    const bad = `<html><head><script type="application/ld+json">{ not valid json </script></head><body>x</body></html>`;
    expect(extractStructuredData(bad)).toBeNull();
  });
});

describe('preprocessForVenue (generic path)', () => {
  it('surfaces structured data ahead of the HTML fallback for non-bespoke venues', () => {
    const res = preprocessForVenue(JSON_LD_PAGE, { id: 'kinoteka' });
    expect(res.usedFallback).toBe(true);
    expect(res.cleaned).toContain('STRUCTURED DATA');
    expect(res.cleaned).toContain('Rozmowa');
    expect(res.hint).toMatch(/structured event data/i);
  });

  it('leaves a plain server-rendered page as just the cleaned body', () => {
    const res = preprocessForVenue(PLAIN_PAGE, { id: 'kinoteka' });
    expect(res.cleaned).not.toContain('STRUCTURED DATA');
    expect(res.cleaned).toContain('Repertuar');
    expect(res.hint).toBeNull();
  });
});

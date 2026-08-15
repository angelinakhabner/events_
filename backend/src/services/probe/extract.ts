import type { ProbeLocale, ProbeSampleEvent } from '@afisz/shared';
import { env } from '../../config.js';
import { extractEvents, type ExtractorClient } from '../scraper/extractor.js';
import { PROBE_WINDOW_DAYS } from './detectors.js';

/**
 * The one LLM path the probe has (GOI-72 §4.6, §9).
 *
 * Detector E and the paid tier both come through here, which is the point: the
 * free ladder and the paid render must agree about what a page says, and the
 * only way to guarantee that is for there to be a single extractor call.
 *
 * The probe has no venue yet — that's what it's helping create — so the prompt
 * gets a placeholder venue. Only `category` really matters to it, and 'other'
 * is what makes it read everything rather than only films.
 */
export type ProbeExtractor = (input: {
  text: string;
  url: string;
  locale: ProbeLocale;
}) => Promise<ProbeSampleEvent[]>;

export function createProbeExtractor(client?: ExtractorClient): ProbeExtractor {
  return async ({ text, url }) => {
    const rows = await extractEvents(
      text,
      {
        name: hostOf(url),
        city: 'Warsaw',
        timezone: 'Europe/Warsaw',
        category: 'other',
        url,
      },
      new Date(),
      { client, windowDays: PROBE_WINDOW_DAYS },
    );
    return toSamples(rows);
  };
}

/** Null when the deployment has no key — the probe then simply stops after
 *  detector D rather than failing, and diagnosis explains the miss. */
export function defaultProbeExtractor(): ProbeExtractor | undefined {
  return env.ANTHROPIC_API_KEY ? createProbeExtractor() : undefined;
}

/** Extractor rows → the title-and-date pairs the user eyeballs. Rows without a
 *  usable title are dropped; a row with an unparseable date is kept undated,
 *  since "we found this, we're unsure when" is still a useful confirmation. */
export function toSamples(rows: unknown[]): ProbeSampleEvent[] {
  const out: ProbeSampleEvent[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (!title) continue;
    const raw = typeof r.starts_at === 'string' ? r.starts_at : null;
    const parsed = raw ? new Date(raw) : null;
    out.push({
      title,
      startsAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    });
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

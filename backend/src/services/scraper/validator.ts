import { z } from 'zod';

/** Schema for one extractor output row (matches the Claude prompt schema). */
export const EventSchema = z.object({
  title: z.string().min(1).transform(normalizeTitle),
  starts_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO timestamp'),
  duration_minutes: z.number().int().positive().nullable(),
  language: z.string().min(1).nullable(),
  director: z.string().min(1).nullable(),
  cast: z.array(z.string()).nullable(),
  description: z.string().nullable(),
  price_min: z.number().int().nonnegative().nullable(),
  price_max: z.number().int().nonnegative().nullable(),
  source_url: z.string().url(),
  source_id: z.string().min(1).nullable().optional().transform((v) => v ?? null),
});

export type ValidatedEvent = z.infer<typeof EventSchema>;

export interface ValidationResult {
  valid: ValidatedEvent[];
  invalid: { entry: unknown; error: string }[];
}

export interface ValidateOptions {
  /** Venue category — drives the all-day vs timed start-time rule. */
  category?: string;
  /** Venue timezone for resolving the local wall-clock of starts_at. */
  timezone?: string;
}

/**
 * Categories whose events legitimately have no clock time (all-day). For these
 * a local-midnight start is fine; for everything else (cinema, theatre, comedy,
 * concert…) a 00:00 start almost always means the extractor couldn't find the
 * real showtime and defaulted to midnight — which is worse than dropping the
 * row, because it surfaces a confidently-wrong time to users.
 */
const ALL_DAY_CATEGORIES = new Set(['exhibition']);

export function validateEvents(raw: unknown, opts: ValidateOptions = {}): ValidationResult {
  const out: ValidationResult = { valid: [], invalid: [] };
  if (!Array.isArray(raw)) {
    return { valid: [], invalid: [{ entry: raw, error: 'top-level value is not an array' }] };
  }
  for (const entry of raw) {
    const parsed = EventSchema.safeParse(entry);
    if (!parsed.success) {
      out.invalid.push({ entry, error: parsed.error.message });
      continue;
    }
    if (isSuspectMidnight(parsed.data.starts_at, opts)) {
      out.invalid.push({
        entry,
        error: 'starts_at is local midnight for a timed venue — likely a missing showtime, not a real 00:00 start',
      });
      continue;
    }
    out.valid.push(parsed.data);
  }
  return out;
}

/** True when starts_at lands exactly on 00:00 local time for a timed venue. */
function isSuspectMidnight(iso: string, opts: ValidateOptions): boolean {
  const { category, timezone } = opts;
  if (!category || ALL_DAY_CATEGORIES.has(category)) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'Europe/Warsaw',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', // 00..23 — avoids the '24:00' midnight quirk of hour12:false
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  const minute = parts.find((p) => p.type === 'minute')?.value;
  return hour === '00' && minute === '00';
}

/** Trim and collapse internal whitespace. Preserves Polish diacritics. */
function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

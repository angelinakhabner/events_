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

export function validateEvents(raw: unknown): ValidationResult {
  const out: ValidationResult = { valid: [], invalid: [] };
  if (!Array.isArray(raw)) {
    return { valid: [], invalid: [{ entry: raw, error: 'top-level value is not an array' }] };
  }
  for (const entry of raw) {
    const parsed = EventSchema.safeParse(entry);
    if (parsed.success) {
      out.valid.push(parsed.data);
    } else {
      out.invalid.push({ entry, error: parsed.error.message });
    }
  }
  return out;
}

/** Trim and collapse internal whitespace. Preserves Polish diacritics. */
function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

import { z } from 'zod';

/**
 * The shape of a newsletter subscription as callers supply it.
 *
 * Lives here rather than next to the tRPC router because there are now two
 * front doors onto the same subscription — the SPA's tRPC procedures and the
 * public REST API (GOI-87). Sharing one schema is what keeps them from
 * drifting: a field added for the app is accepted by the API on the same
 * commit, with the same bounds and the same defaults.
 */
export const newsletterSaveInput = z.object({
  email: z.string().email(),
  /** Name the brief greets you by; blank greets you without one. */
  recipientName: z.string().trim().max(80).nullable().optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  venueIds: z.array(z.string()).default([]),
  afterHour: z.number().int().min(0).max(23).nullable().optional(),
  beforeHour: z.number().int().min(0).max(23).nullable().optional(),
  /** Warsaw hour the brief is sent at. */
  sendHour: z.number().int().min(0).max(23).default(8),
  /** Minute past that hour (0-59). */
  sendMinute: z.number().int().min(0).max(59).default(0),
  /** Weekday weekly briefs go out on (0=Sun … 6=Sat). */
  sendWeekday: z.number().int().min(0).max(6).default(1),
  /** Per-category cadence + detail; empty = one brief covering everything. */
  categoryRules: z
    .array(
      z.object({
        category: z.string().trim().min(1).max(40),
        frequency: z.enum(['daily', 'weekly', 'monthly']),
        detail: z.enum(['short', 'full']),
      }),
    )
    .max(20)
    .default([]),
  enabled: z.boolean().default(true),
});

export type NewsletterSaveInput = z.infer<typeof newsletterSaveInput>;

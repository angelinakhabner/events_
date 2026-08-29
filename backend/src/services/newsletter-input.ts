import { z } from 'zod';
import { allowedRuleCadences } from '@afisz/shared';

/**
 * The shape of a newsletter config as callers supply it.
 *
 * Lives here rather than next to the tRPC router because there are two front
 * doors onto the same config — the SPA's tRPC procedures and the public REST
 * API (GOI-87). Sharing one schema is what keeps them from drifting: a field
 * added for the app is accepted by the API on the same commit, with the same
 * bounds and the same defaults.
 *
 * The validity rules (GOI-100) are enforced here rather than only in the UI.
 * A settings screen that clamps its own dropdowns is a convenience; it is not
 * a guarantee, and the public API has no dropdowns at all.
 */

const ruleCadence = z.enum(['every_issue', 'weekly', 'monthly']);
const sendCadence = z.enum(['daily', 'weekly', 'monthly']);

export const newsletterCategoryRuleInput = z.object({
  category: z.string().trim().min(1).max(40),
  cadence: ruleCadence.default('every_issue'),
  /** Which issue carries it, when cadence=weekly on a daily newsletter. */
  cadenceWeekday: z.number().int().min(0).max(6).nullable().default(null),
  detail: z.enum(['line', 'short', 'full']).default('short'),
  timeFilter: z.enum(['any', 'after_17', 'after_18', 'after_19', 'after_20']).default('any'),
  /** Overrides the derived coverage window. 1-90: below a day it selects
   *  nothing, and beyond a quarter it is not a newsletter section. */
  lookaheadDays: z.number().int().min(1).max(90).nullable().default(null),
  sortOrder: z.number().int().min(0).max(99).default(0),
});

export const newsletterSaveInput = z
  .object({
    email: z.string().email(),
    /** Name the brief greets you by; blank greets you without one. */
    recipientName: z.string().trim().max(80).nullable().optional(),
    /** Which folder's venues this newsletter draws on. */
    folderId: z.string().uuid().nullable().default(null),
    name: z.string().trim().min(1).max(60).default('Newsletter'),
    /** When an issue is sent. */
    sendCadence: sendCadence,
    /** Venues within the folder; empty = all of them. */
    venueIds: z.array(z.string()).default([]),
    beforeHour: z.number().int().min(0).max(23).nullable().optional(),
    /** Hour the issue is sent at. */
    sendHour: z.number().int().min(0).max(23).default(8),
    /** Minute past that hour (0-59). */
    sendMinute: z.number().int().min(0).max(59).default(0),
    /** Weekday weekly issues go out on (0=Sun … 6=Sat). */
    sendWeekday: z.number().int().min(0).max(6).nullable().default(null),
    /** Day monthly issues go out on. 28 is the cap so every month has one. */
    sendDayOfMonth: z.number().int().min(1).max(28).nullable().default(null),
    timezone: z.string().min(1).max(60).default('Europe/Warsaw'),
    suppressEmptyIssues: z.boolean().default(true),
    wantToGo: z
      .object({
        enabled: z.boolean().default(true),
        horizonDays: z.number().int().min(1).max(30).default(7),
        changesEnabled: z.boolean().default(true),
        urgentSend: z.boolean().default(true),
      })
      .default({ enabled: true, horizonDays: 7, changesEnabled: true, urgentSend: true }),
    categoryRules: z.array(newsletterCategoryRuleInput).max(20).default([]),
    enabled: z.boolean().default(true),
  })
  // Rule 3: the schedule field the cadence needs must be there, and only that
  // one. A weekly newsletter with no weekday has no send day at all.
  .superRefine((v, ctx) => {
    if (v.sendCadence === 'weekly' && v.sendWeekday == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sendWeekday'],
        message: 'A weekly newsletter needs a day of the week to go out on.',
      });
    }
    if (v.sendCadence === 'monthly' && v.sendDayOfMonth == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sendDayOfMonth'],
        message: 'A monthly newsletter needs a day of the month to go out on.',
      });
    }
  })
  // Rule 1: a category cannot appear more often than an issue is sent. There
  // is no "once a week" inside a weekly newsletter — that is every issue.
  .superRefine((v, ctx) => {
    const allowed = allowedRuleCadences(v.sendCadence);
    v.categoryRules.forEach((rule, i) => {
      if (!allowed.includes(rule.cadence)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categoryRules', i, 'cadence'],
          message:
            `A ${v.sendCadence} newsletter cannot carry a category ${cadenceWord(rule.cadence)} — ` +
            'that is more often than an issue goes out.',
        });
      }
    });
  })
  // Rule 4: a config with no category rules and no want-to-go can never
  // produce content. Saving it would schedule an email that is empty by
  // construction, which is worse than refusing it.
  .superRefine((v, ctx) => {
    if (v.categoryRules.length === 0 && !v.wantToGo.enabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoryRules'],
        message:
          'This newsletter would always be empty. Add a category, or turn on saved events.',
      });
    }
  })
  // Rule 2: null out what does not apply, rather than storing a value that
  // does nothing. Done here so both front doors agree, and so the stored row
  // cannot disagree with the cadence beside it.
  .transform((v) => ({
    ...v,
    sendWeekday: v.sendCadence === 'weekly' ? (v.sendWeekday ?? 1) : null,
    sendDayOfMonth: v.sendCadence === 'monthly' ? (v.sendDayOfMonth ?? 1) : null,
    categoryRules: v.categoryRules.map((r, i) => ({
      ...r,
      cadenceWeekday:
        v.sendCadence === 'daily' && r.cadence === 'weekly' ? (r.cadenceWeekday ?? 1) : null,
      sortOrder: r.sortOrder || i,
    })),
  }));

function cadenceWord(cadence: 'every_issue' | 'weekly' | 'monthly'): string {
  if (cadence === 'weekly') return 'once a week';
  if (cadence === 'monthly') return 'once a month';
  return 'in every issue';
}

export type NewsletterSaveInput = z.infer<typeof newsletterSaveInput>;

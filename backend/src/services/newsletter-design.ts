import type { NewsletterDesign } from '@afisz/shared';
import { renderBriefHtml, type BriefContent } from './newsletter-render.js';
import { renderBriefPdf, type BriefPdfContent } from './newsletter-pdf.js';
import { renderAfiszkaHtml } from './newsletter-afiszka-html.js';
import { renderAfiszkaPdf } from './newsletter-afiszka-pdf.js';

/**
 * One issue, drawn in whichever design its reader chose (`NewsletterDesign`).
 *
 * The sweep, the urgent-change email, "Generate" and the drive copy all render
 * through here, so a reader on the AFISZ.KA design gets it everywhere at once —
 * the email and the filed PDF never come out in two different designs.
 * `classic` is exactly what the brief was before the choice existed.
 */
export type NewsletterBrief = BriefContent & BriefPdfContent & { design?: NewsletterDesign };

export function renderNewsletterHtml(brief: NewsletterBrief): string {
  return brief.design === 'afiszka' ? renderAfiszkaHtml(brief) : renderBriefHtml(brief);
}

export function renderNewsletterPdf(brief: NewsletterBrief): Promise<Buffer> {
  return brief.design === 'afiszka' ? renderAfiszkaPdf(brief) : renderBriefPdf(brief);
}

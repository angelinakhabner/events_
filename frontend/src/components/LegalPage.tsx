import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CONTACT_EMAIL, type PolicyBlock, type PolicySection } from '../landing/content';

/**
 * The in-app rendering of a document from `src/landing/content.ts` (GOI-95).
 *
 * The copy is not written here, and deliberately so. The privacy policy exists
 * twice on this site — once as static HTML on the public landing page, so a
 * stranger and a crawler can read it without running any JavaScript, and once
 * as this route, so someone already inside the app can reach it from the
 * footer. Two copies of a legal document are two documents, and they drift:
 * the first draft of this page named a different contact address from the
 * landing page's, which is the kind of discrepancy that makes a policy worse
 * than useless. So there is one source of copy and two presentations of it.
 *
 * These pages are read differently from everything else in the app — someone
 * opens them to find one clause, not to browse. Hence a measured column rather
 * than the full page width, numbered sections that can be cited ("section 7"),
 * and the date the text last changed at the top, because a document without
 * one tells you nothing about whether it covers what happened to you.
 */
export function LegalPage({
  title,
  intro,
  updated,
  sections,
  seeAlso,
}: {
  title: string;
  intro: string;
  /** Human-readable date the text last changed, e.g. "29 August 2026". */
  updated: string;
  sections: readonly PolicySection[];
  /** The other document — each points at the other, and only at the other. */
  seeAlso: { to: string; label: string };
}) {
  // The document title is how these pages get cited and bookmarked, and both
  // of them are otherwise "AFISZ".
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} — AFISZ`;
    return () => { document.title = previous; };
  }, [title]);

  return (
    <article className="page-x py-10 md:py-16">
      <div className="max-w-[68ch]">
        <p className="tag m-0">Last updated {updated}</p>
        <h1
          className="font-display leading-[0.98] tracking-[0.5px] m-0 mt-3"
          style={{ fontSize: 'clamp(34px, 6vw, 60px)' }}
        >
          {title}
        </h1>
        <p className="mt-4 text-base md:text-lg font-medium text-body">{intro}</p>
        <div className="rule-ink mt-8" />

        {sections.map((section, i) => (
          <Clause key={section.heading} n={i + 1} heading={section.heading} blocks={section.blocks} />
        ))}

        <p className="mt-12 border-t-2 border-divider pt-6 text-[15px] md:text-base text-body">
          See also the{' '}
          <Link to={seeAlso.to} className="underline hover:text-accent">{seeAlso.label}</Link>.
        </p>
      </div>
    </article>
  );
}

/**
 * One numbered clause. The number is rendered rather than left to an ordered
 * list so it can be linked to and quoted — a complaint or a data request that
 * cites "section 6" needs 6 to be visible on the page and its anchor to
 * resolve.
 */
function Clause({ n, heading, blocks }: { n: number; heading: string; blocks: readonly PolicyBlock[] }) {
  const id = `s${n}`;
  return (
    <section id={id} className="mt-9 scroll-mt-6">
      <h2 className="m-0 flex gap-3 text-[19px] md:text-[22px] font-extrabold leading-[1.25]">
        <a href={`#${id}`} className="shrink-0 text-accent no-underline tabular-nums hover:underline">
          {n}
        </a>
        <span className="text-ink">{heading}</span>
      </h2>
      <div className="mt-3 space-y-3 text-[15px] md:text-base leading-[1.6] text-body">
        {blocks.map((block, i) =>
          block.kind === 'p' ? (
            <p key={i} className="m-0">{withEmail(block.text)}</p>
          ) : (
            <ul key={i} className="m-0 list-disc space-y-2 pl-5">
              {block.items.map((item, j) => <li key={j}>{withEmail(item)}</li>)}
            </ul>
          ),
        )}
      </div>
    </section>
  );
}

/**
 * Expand the copy's `{email}` placeholder into a real mailto link.
 *
 * The static renderer does the same thing with a string of HTML; here it has
 * to produce React nodes instead, and the two must agree — a placeholder left
 * unexpanded would print a literal `{email}` in the middle of a sentence that
 * is telling someone how to exercise a legal right.
 */
function withEmail(text: string): React.ReactNode {
  const parts = text.split('{email}');
  if (parts.length === 1) return text;
  return parts.flatMap((part, i) =>
    i === 0
      ? [part]
      : [
          <a key={i} href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-accent">
            {CONTACT_EMAIL}
          </a>,
          part,
        ],
  );
}

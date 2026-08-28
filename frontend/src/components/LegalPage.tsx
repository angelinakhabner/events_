import { useEffect } from 'react';

/**
 * The shared frame for /policy and /terms (GOI-95).
 *
 * These two pages are the only long-form prose in an app that is otherwise
 * listings, and they are read differently from everything else — someone opens
 * them to find one clause, not to browse. So: a measured column rather than the
 * full page width, numbered sections that can be cited ("section 7.2"), and the
 * date the text was last changed at the top, because a policy without one tells
 * you nothing about whether it covers what happened to you.
 *
 * The poster chrome stays — heavy rules, Anton headings — but the body is set
 * at a reading size instead of the interface's 13px.
 */
export function LegalPage({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro: string;
  /** ISO date the text last changed. */
  updated: string;
  children: React.ReactNode;
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
        <p className="tag m-0">Last updated {formatUpdated(updated)}</p>
        <h1
          className="font-display leading-[0.98] tracking-[0.5px] m-0 mt-3"
          style={{ fontSize: 'clamp(34px, 6vw, 60px)' }}
        >
          {title}
        </h1>
        <p className="mt-4 text-base md:text-lg font-medium text-body">{intro}</p>
        <div className="rule-ink mt-8" />
        {children}
      </div>
    </article>
  );
}

/**
 * A numbered clause. The number is rendered rather than left to an ordered
 * list so it can be linked to and quoted — a complaint or a data request that
 * cites "section 6.3" needs 6.3 to be visible on the page.
 */
export function Clause({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  const id = `s${n.replace(/\./g, '-')}`;
  return (
    <section id={id} className="mt-9 scroll-mt-6">
      <h2 className="m-0 flex gap-3 text-[19px] md:text-[22px] font-extrabold leading-[1.25]">
        <a href={`#${id}`} className="shrink-0 text-accent no-underline tabular-nums hover:underline">
          {n}
        </a>
        <span className="text-ink">{title}</span>
      </h2>
      <div className="mt-3 space-y-3 text-[15px] md:text-base leading-[1.6] text-body">
        {children}
      </div>
    </section>
  );
}

/** A definition-style row — used for the data table and the glossary. */
export function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="rule-soft py-3 first:pt-0">
      <p className="m-0 text-[13px] font-extrabold uppercase tracking-[0.5px] text-ink">{term}</p>
      <p className="m-0 mt-1.5">{children}</p>
    </div>
  );
}

/** An unordered list in the body's own type, since prose lists are frequent
 *  here and the default browser one is set at the wrong size. */
export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="m-0 list-disc space-y-2 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

const updatedFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

function formatUpdated(iso: string): string {
  return updatedFmt.format(new Date(`${iso}T12:00:00Z`));
}

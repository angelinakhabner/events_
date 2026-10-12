import type { ProbeOutcome, ProbeSampleEvent, SourceMethod } from '@afisz/shared';

/**
 * What the CHECK button says back (GOI-72 §5, §8).
 *
 * The old version printed `✗ {reason}` for everything, where `reason` was
 * whatever string the server happened to produce — including a raw Zod
 * complaint. Two things changed here. Every failure is now one of thirteen
 * coded sentences, and a `needs_decision` renders *differently* from a `fatal`
 * one: they mean "we need something from you", not "this is broken", and
 * showing them in the same red as a dead link is what makes users give up on a
 * venue that would work with a deeper link.
 */

/** Plain-English gloss of how we'd read the venue. The method name is
 *  operator vocabulary; this is what it means for the user. */
const METHOD_BLURB: Record<SourceMethod, string> = {
  jsonld: 'the page publishes its programme as structured data',
  ical: 'the venue offers a calendar feed',
  wp_rest: 'the venue’s events API answers',
  wp_rest_posts: 'we can read the venue’s posts, though they aren’t structured events',
  rss: 'the venue publishes a feed',
  llm_extract: 'we can read the programme off the page',
  firecrawl: 'we can read it with a full browser render',
  manual: 'this venue is configured by hand',
};

/** Free to refetch — worth saying, because it's why we don't mind sweeping it
 *  daily. */
const FREE_METHODS: SourceMethod[] = ['jsonld', 'ical', 'wp_rest'];

export function ProbeResultNote({
  result,
  onTryPaid,
  paidPending,
}: {
  result: ProbeOutcome;
  /** Runs the same check with allowPaid. Absent → the button isn't offered. */
  onTryPaid?: () => void;
  paidPending?: boolean;
}) {
  if (result.status === 'success') return <Success result={result} />;

  const decision = result.severity === 'needs_decision';
  return (
    <div
      role="status"
      className={`mt-2 border-l-3 pl-3 ${decision ? 'border-ink' : 'border-accent'}`}
    >
      <p className={`m-0 text-sm font-bold ${decision ? 'text-ink' : 'text-accent'}`}>
        {decision ? '' : '✗ '}
        {result.message}
      </p>

      {/* This one almost always works on a second try, so say how. */}
      {result.code === 'NO_LISTING_PAGE_FOUND' || result.code === 'NO_EVENTS_FOUND' ? (
        <p className="mt-1 mb-0 text-xs text-muted">
          Venues usually list under <em>Repertuar</em>, <em>Program</em> or <em>Wydarzenia</em> —
          open that page and paste its address.
        </p>
      ) : null}

      {result.code === 'JS_RENDERED_NEEDS_PAID' && onTryPaid ? (
        <button
          type="button"
          onClick={onTryPaid}
          disabled={paidPending}
          className="act act-sm act-on mt-2"
        >
          {paidPending ? 'Trying paid fetch…' : 'Try paid fetch (uses 1 credit)'}
        </button>
      ) : null}
    </div>
  );
}

function Success({ result }: { result: Extract<ProbeOutcome, { status: 'success' }> }) {
  return (
    <div role="status" className="mt-2 border-l-3 border-ink pl-3">
      <p className="m-0 text-sm font-bold text-ink">
        ✓ {result.shared ? 'Already tracked' : 'Scrapable'} — {METHOD_BLURB[result.method]}
        {FREE_METHODS.includes(result.method) ? ', and it costs nothing to keep fresh' : ''}.
      </p>

      {result.shared ? (
        <p className="mt-1 mb-0 text-xs text-muted">
          Someone already added this URL — you&rsquo;ll share it, and it&rsquo;s scraped once for
          everyone.
        </p>
      ) : null}

      {result.confidence === 'low' ? (
        <p className="mt-1 mb-0 text-xs text-muted">
          We only found blog posts here, so what we pull may be news rather than events.
        </p>
      ) : null}

      {result.sampleEvents.length > 0 ? <SampleEvents events={result.sampleEvents} /> : null}
    </div>
  );
}

/** The confirmation step: seeing the actual titles is the only way to tell a
 *  scraper that read the programme from one that read the cookie banner. */
function SampleEvents({ events }: { events: ProbeSampleEvent[] }) {
  return (
    <div className="mt-2">
      <p className="tag m-0 mb-1">Found here</p>
      <ul className="list-none m-0 p-0">
        {events.map((e, i) => (
          <li key={`${e.title}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="tag text-[11px] shrink-0">{formatSampleDate(e.startsAt)}</span>
            <span className="text-ink">{e.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dates only, in the venue's timezone. An undated entry says so rather than
 *  being given a fabricated time — that's the exhibition case. */
export function formatSampleDate(startsAt: string | null): string {
  if (!startsAt) return 'no date';
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return 'no date';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(d);
}

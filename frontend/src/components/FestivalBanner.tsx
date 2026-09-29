import { useState } from 'react';
import { bannerFestivals, type Festival } from '@afisz/shared';
import { formatRange } from './FestivalsSection';

/**
 * A festival announcing itself at the top of the page (GOI-99).
 *
 * Festivals used to appear only as "Coming soon" at the *foot* of the listing,
 * under everything else — which is where you put something a reader may
 * eventually scroll to, not something that changes what they are reading. And
 * a festival does change it: Skrzyżowanie Kultur arrives in Teatr Dramatyczny's
 * repertoire as six identical rows reading "FESTIWAL SKRZYŻOWANIE KULTUR",
 * saying nothing about what it is, spread through a listing that gives no clue
 * they are one thing. The banner is the sentence those rows are missing, and
 * it has to be above them to be that.
 *
 * It is deliberately narrow about *when*: on now, or opening within a
 * fortnight (`bannerFestivals`). A banner for something in November, printed
 * over the top of a page opened to find out what is on tonight, is an
 * advertisement — and once the top of the page is an advertisement, it stops
 * being read at all. Everything outside that window stays in the listing's own
 * "Coming soon", which is the right place for it.
 *
 * The artwork is the festival's own, taken from its site. Where there is none
 * — or where the URL has since died, which is why `onError` matters — the
 * banner sets the name in the app's display type over the ink band instead.
 * That is a poster too, and it is one that cannot break.
 *
 * The whole card used to be an `<a>`, unconditionally. That made the banner
 * only as good as the link behind it, and one of the links was
 * `skrzyzowaniekultur.pl` — a domain with no DNS record — so the masthead
 * announcing the festival handed the reader "Safari can't find the server"
 * (GOI-109). A festival we can't link is still worth announcing, so the card
 * becomes a plain block when `url` is null: same type, same dates, same
 * venues, minus a promise we can't keep.
 */
export function FestivalBanner({
  festivals,
  now,
  /** Named for a screen reader; /my says whose venues these are. */
  label = 'Festivals on now',
}: {
  festivals: Festival[] | undefined;
  now?: Date;
  label?: string;
}) {
  const showing = bannerFestivals(festivals ?? [], now);
  if (showing.length === 0) return null;

  return (
    <section aria-label={label} className="border-b-4 border-ink">
      {showing.map((f) => (
        <FestivalBannerCard key={f.id} festival={f} />
      ))}
    </section>
  );
}

function FestivalBannerCard({ festival }: { festival: Festival }) {
  // A URL that 404s must not leave a broken-image glyph across the masthead;
  // the typographic banner is the same banner, minus the picture.
  const [artworkFailed, setArtworkFailed] = useState(false);
  const artwork = festival.imageUrl && !artworkFailed ? festival.imageUrl : null;
  const on = festival.status === 'ongoing';
  // `group` still applies without the anchor so the hover styling below has
  // one rule rather than two; on a linkless card nothing changes on hover,
  // which is the honest signal that there is nothing to click.
  const Shell = festival.url ? 'a' : 'div';
  const shellProps = festival.url
    ? ({ href: festival.url, target: '_blank', rel: 'noreferrer' } as const)
    : {};

  return (
    <Shell {...shellProps} className="group block bg-ink text-white no-underline">
      <div className="md:flex md:items-stretch">
        {artwork ? (
          <div className="md:w-[38%] md:shrink-0">
            <img
              src={artwork}
              alt=""
              loading="lazy"
              onError={() => setArtworkFailed(true)}
              className="h-24 w-full object-cover md:h-full md:min-h-[128px]"
            />
          </div>
        ) : null}

        <div className="page-x py-4 md:py-5 md:flex-1">
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] md:text-xs font-extrabold uppercase tracking-[1.5px]">
            {/* "Now on" and "Coming soon" are the two things a festival can be
                worth a banner for, and they are not the same news. */}
            <span className={on ? 'text-accent' : 'text-[#c9c4bc]'}>
              {on ? 'Now on' : 'Coming soon'}
            </span>
            <span aria-hidden className="text-[#6f6a63]">·</span>
            <span className="text-white tabular-nums">
              {formatRange(festival.startDate, festival.endDate)}
            </span>
          </p>

          <h2
            className="font-display leading-[1.02] tracking-[0.5px] m-0 mt-1.5 group-hover:text-accent"
            style={{ fontSize: 'clamp(22px, min(3.2vw, 4vh), 36px)' }}
          >
            {festival.name}
          </h2>

          {/* One line, and cut rather than wrapped: the banner is a headline,
              and the festival's own site is a click away for the rest
              (GOI-114). */}
          <p className="mt-1.5 max-w-[560px] truncate text-xs md:text-sm font-medium text-[#c9c4bc]">
            {festival.description}
          </p>

          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 m-0 text-[11px] md:text-xs font-extrabold uppercase tracking-[1px]">
            <span className="text-[#8d8b87]">{venueLine(festival)}</span>
            {festival.url ? (
              <span className="text-accent group-hover:underline">Festival site →</span>
            ) : null}
          </p>
        </div>
      </div>
    </Shell>
  );
}

/**
 * Which venues it is at. `FestivalAtVenues` carries the reader's *own* names
 * for them (GOI-33) — a personal rename included — so /my says "at Teatr
 * Dramatyczny" in the words the reader files it under, and Home falls back to
 * the curated list's own spelling.
 */
function venueLine(festival: Festival): string {
  const yours = (festival as { yourVenues?: string[] }).yourVenues;
  const names = yours && yours.length > 0 ? yours : festival.venues;
  return names.join(' · ');
}

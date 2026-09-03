/**
 * Verify every festival link in `FESTIVAL_SEEDS` actually resolves (GOI-109).
 *
 * The seeds are hand-curated, and the failure this exists to catch is not a
 * typo — it is a URL that looks exactly right and isn't there. Warsaw's
 * crossroads-of-cultures festival is obviously at `skrzyzowaniekultur.pl`;
 * that domain has no DNS record and is parked for sale, and the banner
 * announcing the festival at the top of the home page linked to it for weeks.
 * Nothing in a type or a unit test can tell those two URLs apart. Only a
 * request can.
 *
 * The dev sandbox can't reach venue or festival sites, so this runs on a
 * runner (the `festival-links` job in .github/workflows/venue-diagnose.yml)
 * or on any machine with plain outbound HTTPS:
 *
 *     npm --prefix backend run festivals:check-links
 *
 * Exits non-zero when a link is dead, so it can gate a change to the seeds.
 * A seed with `url: null` is not a failure — that is the documented way to
 * say "no verified site", and it renders without a link.
 */
import { FESTIVAL_SEEDS } from '../data/festivals.js';

const TIMEOUT_MS = 15_000;
/** Sites reject an unfamiliar agent more often than they reject a real one. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

type Verdict = 'ok' | 'dead' | 'suspect';

interface Check {
  id: string;
  name: string;
  url: string | null;
  verdict: Verdict;
  detail: string;
}

async function check(url: string): Promise<{ verdict: Verdict; detail: string }> {
  // GET, not HEAD: a parked domain and a misconfigured host both answer HEAD
  // in ways that look fine, and some real sites refuse HEAD outright.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    });
    const landed = res.url && res.url !== url ? ` → ${res.url}` : '';
    // 401/403/429 is what a WAF says to something that isn't a browser, not
    // what a missing site says — teatrdramatyczny.pl and polin.pl both answer
    // this repo's own scraper with 403 while being perfectly alive. Reporting
    // those as dead would send someone to delete a working link, so they are
    // flagged for a human instead. It is also what an egress proxy returns for
    // a host it won't let through, which is the answer from a dev sandbox.
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return { verdict: 'suspect', detail: `HTTP ${res.status} (bot-blocked or proxied?)${landed}` };
    }
    if (res.status >= 400) return { verdict: 'dead', detail: `HTTP ${res.status}${landed}` };
    // A 2xx from a different registrable domain is a parking page or a
    // for-sale listing often enough to be worth a human's eye, not a failure.
    if (registrableHost(res.url) !== registrableHost(url)) {
      return { verdict: 'suspect', detail: `HTTP ${res.status}, redirected off-domain${landed}` };
    }
    return { verdict: 'ok', detail: `HTTP ${res.status}${landed}` };
  } catch (e) {
    // DNS failure lands here — the skrzyzowaniekultur.pl case exactly.
    return { verdict: 'dead', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function registrableHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function main(): Promise<void> {
  const results: Check[] = [];
  for (const seed of FESTIVAL_SEEDS) {
    if (!seed.url) {
      results.push({ id: seed.id, name: seed.name, url: null, verdict: 'ok', detail: 'no link (by design)' });
      continue;
    }
    const { verdict, detail } = await check(seed.url);
    results.push({ id: seed.id, name: seed.name, url: seed.url, verdict, detail });
  }

  for (const r of results) {
    const mark = r.verdict === 'ok' ? 'OK  ' : r.verdict === 'suspect' ? 'HMM ' : 'DEAD';
    console.log(`${mark} ${r.id}  ${r.url ?? '—'}  ${r.detail}`);
  }

  const dead = results.filter((r) => r.verdict === 'dead');
  const suspect = results.filter((r) => r.verdict === 'suspect');
  if (suspect.length > 0) {
    console.log(
      `\nCouldn't decide — open these by hand:\n` +
      suspect.map((r) => `  ${r.id}: ${r.url} (${r.detail})`).join('\n'),
    );
  }
  console.log(
    `\n${results.length} festival(s): ${results.length - dead.length - suspect.length} ok, ` +
    `${suspect.length} to eyeball, ${dead.length} dead`,
  );
  if (dead.length > 0) {
    console.error(
      `\nDead links — set url to null, or replace with the festival's real page:\n` +
      dead.map((r) => `  ${r.id}: ${r.url} (${r.detail})`).join('\n'),
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

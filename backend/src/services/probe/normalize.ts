import type { ProbeErrorCode } from '@afisz/shared';

/**
 * Turn whatever the user pasted into a URL we can fetch and store (GOI-72 §1).
 *
 * The reported bug is the whole reason this exists: `www.teatr-zydowski.art.pl`
 * went straight into `z.string().url()`, which rejects a bare host, and the raw
 * Zod complaint ("Invalid url") reached the UI. Normalization runs *before* any
 * validation, and nothing here ever throws.
 *
 * It is also the SSRF boundary. This endpoint fetches an arbitrary string on
 * request from a logged-in user, so the guard belongs at the point where the
 * string first becomes a URL — not at the fetch, where a later redirect or a
 * second code path could route around it.
 */

export type NormalizeResult =
  | { ok: true; url: URL }
  | { ok: false; code: Extract<ProbeErrorCode, 'INVALID_URL' | 'SOCIAL_ONLY'> };

/** Query parameters that identify a campaign, not a page. */
const TRACKING_PARAMS = ['fbclid', 'gclid', 'ref'];
const TRACKING_PREFIXES = ['utm_'];

/**
 * Refused at normalization time rather than fetched and diagnosed: we can't
 * read a logged-out Facebook page anyway, and not sending the request at all
 * is the only way to be sure we never do.
 */
const SOCIAL_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'fb.com',
  'www.fb.com',
  'instagram.com',
  'www.instagram.com',
]);

export function normalizeVenueUrl(input: string): NormalizeResult {
  const trimmed = stripWrappers(input);
  if (!trimmed) return { ok: false, code: 'INVALID_URL' };

  // A bare host is what people actually paste. Only assume a scheme when there
  // is no `://` at all — "ftp://x" must stay ftp so step 4 can reject it,
  // rather than becoming "https://ftp://x".
  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, code: 'INVALID_URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'INVALID_URL' };
  }

  // Lowercase the host and drop the FQDN root dot before any host test, so a
  // guard can't be dodged with "LOCALHOST." or "127.0.0.1.".
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  url.hostname = host;

  if (SOCIAL_HOSTS.has(host)) return { ok: false, code: 'SOCIAL_ONLY' };
  if (!isPublicHost(host)) return { ok: false, code: 'INVALID_URL' };

  // Credentials in a venue URL are always a mistake, and forwarding them to a
  // third-party site would leak them.
  url.username = '';
  url.password = '';

  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.includes(lower) || TRACKING_PREFIXES.some((p) => lower.startsWith(p))) {
      url.searchParams.delete(key);
    }
  }

  url.hash = '';
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return { ok: true, url };
}

/** Convenience for callers that only want the string. */
export function normalizedHref(input: string): string | null {
  const res = normalizeVenueUrl(input);
  return res.ok ? res.url.toString() : null;
}

/** Quotes, angle brackets and zero-width junk that survive a copy-paste. */
function stripWrappers(input: string): string {
  return input
    // Zero-width space/non-joiner/joiner, word joiner and BOM — invisible in a
    // paste, fatal to `new URL()`.
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim()
    .replace(/^[<"'“‘]+/, '')
    .replace(/[>"'”’]+$/, '')
    .trim();
}

/**
 * Is this host a name on the public internet? Rejects anything that could
 * address our own infrastructure — the SSRF guard proper.
 *
 * Deliberately a deny-by-default shape: a host must look like a dotted public
 * name *and* not parse as an IP literal in any private range. Hostnames with
 * no dot (`localhost`, `redis`, a Docker service alias, a Kubernetes short
 * name) never reach the network.
 */
export function isPublicHost(host: string): boolean {
  if (!host) return false;

  // IPv6 literals arrive from `URL` still bracketed.
  if (host.startsWith('[') && host.endsWith(']')) {
    return isPublicIpv6(host.slice(1, -1));
  }
  if (isIpv4(host)) return isPublicIpv4(host);
  // A bare IPv6 (no brackets) can't be a hostname either.
  if (host.includes(':')) return isPublicIpv6(host);

  if (!host.includes('.')) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  // Container/cluster-internal suffixes that do resolve, but never to a venue.
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.svc.cluster.local')) {
    return false;
  }
  // A trailing all-numeric label means someone wrote a malformed IP, not a TLD.
  const tld = host.slice(host.lastIndexOf('.') + 1);
  if (!/^[a-z]{2,}$/.test(tld)) return false;

  return true;
}

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isPublicIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return false;                                  // "this network"
  if (a === 10) return false;                                 // RFC1918
  if (a === 127) return false;                                // loopback
  if (a === 169 && b === 254) return false;                   // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;          // RFC1918
  if (a === 192 && b === 168) return false;                   // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false;         // CGNAT
  if (a === 192 && b === 0) return false;                     // IETF protocol assignments
  if (a >= 224) return false;                                 // multicast + reserved
  return true;
}

function isPublicIpv6(host: string): boolean {
  const addr = host.toLowerCase();
  if (addr === '::1' || addr === '::') return false;           // loopback / unspecified
  if (addr.startsWith('fe80')) return false;                   // link-local
  if (/^f[cd]/.test(addr)) return false;                       // unique-local
  // IPv4-mapped addresses must be judged as the v4 address they carry, and
  // they arrive in two spellings: `::ffff:127.0.0.1` as written, and
  // `::ffff:7f00:1` after WHATWG `URL` has canonicalised it to hex. Missing
  // the second is missing loopback entirely.
  const mappedDotted = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedDotted) return isPublicIpv4(mappedDotted[1]!);

  const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    return isPublicIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }

  return true;
}

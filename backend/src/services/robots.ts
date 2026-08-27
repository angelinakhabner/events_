/**
 * Search-engine directives, sent on every route.
 *
 * These outlived the invite gate they shipped with (GOI-83). The site is now
 * open to anyone who wants to log in, but "open to people" and "listed in
 * Google" are separate decisions — venues, events and shared lists are still
 * other people's data. Flip these two constants when the site should be
 * discoverable; nothing else has to change.
 */
export const NOINDEX = 'noindex, nofollow, noarchive';

/** Disallow everything. Served on every route so a crawler that reaches any
 *  path is told the same thing. */
export const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

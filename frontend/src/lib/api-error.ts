/**
 * Turning a server rejection into a sentence.
 *
 * tRPC puts the raw Zod issue array in `error.message` when input validation
 * fails, and the newsletter screen printed it verbatim — a reader pressing
 * "Generate now" got
 *
 *   [ { "expected": "'daily' | 'weekly' | 'monthly'", "received": "undefined",
 *       "code": "invalid_type", "path": [ "frequency" ], "message": "Required" }, … ]
 *
 * which names the problem precisely and communicates nothing. Worse, when the
 * mismatch is a *version* mismatch — this build talking to an API that predates
 * it — the dump is actively misleading: it points at "frequency", a field the
 * form no longer has, so the reader looks for a control that isn't there.
 *
 * So: issues become one line each, and an issue about a field this build never
 * sends is called what it is.
 */

interface ZodIssueLike {
  path?: (string | number)[];
  message?: string;
}

/** `my.newsletter.sendTest` in the message tRPC uses for an unknown route. */
const NO_PROCEDURE = /^No procedure found on path "([^"]+)"/;

export function readableApiError(
  message: string | null | undefined,
  /**
   * Every field name this build's request body can contain, to tell a bad
   * value apart from a field this build does not know.
   *
   * A *static* set describing the payload's shape — never the keys of a
   * payload the caller happens to be holding. An API old enough to reject
   * this build also served the settings the form loaded, so a live payload
   * can carry that older API's own field names straight back to it, and
   * reading the set off one makes the check agree that a stale field is
   * legitimate precisely when it is not (see `NEWSLETTER_FIELDS`).
   */
  known?: ReadonlySet<string>,
): string | null {
  if (!message) return null;

  const route = NO_PROCEDURE.exec(message);
  if (route) {
    return `This page asked the server for “${route[1]}”, which it does not have. `
      + 'The API is running an older build than this page — deploy the backend and retry.';
  }

  const issues = parseIssues(message);
  if (issues.length === 0) return message;

  const lines = issues.map((i) => `${fieldLabel(i.path ?? [])}: ${i.message ?? 'is not valid'}`);
  // A complaint about a field this build cannot send at all is not something
  // touching the form can fix — the two sides disagree about the shape.
  const stale = known !== undefined && known.size > 0 && issues.some((i) => {
    const leaf = leafName(i.path ?? []);
    return leaf !== null && !known.has(leaf);
  });

  return stale
    ? `${lines.join('\n')}\n\nThose fields are not part of this version of the form, `
      + 'so the API is running an older build than this page — deploy the backend and retry.'
    : lines.join('\n');
}

/** The issue array tRPC hands over, or nothing if this is a plain message. */
function parseIssues(message: string): ZodIssueLike[] {
  if (!message.trimStart().startsWith('[')) return [];
  try {
    const parsed: unknown = JSON.parse(message);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is ZodIssueLike => typeof i === 'object' && i !== null && 'message' in i,
    );
  } catch {
    return [];
  }
}

/** `["categoryRules", 1, "cadence"]` → `Category 2 — cadence`. */
function fieldLabel(path: (string | number)[]): string {
  if (path.length === 0) return 'This newsletter';
  const parts: string[] = [];
  for (const segment of path) {
    // Array indices read as positions, and one-based: "categoryRules 1" is the
    // second rule, which is not what the number looks like.
    if (typeof segment === 'number') {
      const last = parts.pop() ?? '';
      parts.push(`${last} ${segment + 1}`.trim());
      continue;
    }
    parts.push(words(segment));
  }
  return capitalise(parts.join(' — '));
}

/** The last named segment, which is the field the issue is actually about. */
function leafName(path: (string | number)[]): string | null {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const segment = path[i];
    if (typeof segment === 'string') return segment;
  }
  return null;
}

/** `categoryRules` → `category rules`, `sendWeekday` → `send weekday`. */
function words(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

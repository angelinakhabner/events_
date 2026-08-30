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
  /** The payload that was sent, if the caller has it. Field names are read off
   *  it to tell a bad value apart from a field this build does not know. */
  sent?: unknown,
): string | null {
  if (!message) return null;

  const route = NO_PROCEDURE.exec(message);
  if (route) {
    return `This page asked the server for “${route[1]}”, which it does not have. `
      + 'The API is running an older build than this page — deploy the backend and retry.';
  }

  const issues = parseIssues(message);
  if (issues.length === 0) return message;

  const known = fieldNames(sent);
  const lines = issues.map((i) => `${fieldLabel(i.path ?? [])}: ${i.message ?? 'is not valid'}`);
  // A complaint about a field that is not in the payload at all cannot be
  // fixed by touching the form — the two sides disagree about the shape.
  const stale = known.size > 0 && issues.some((i) => {
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

/** Every key anywhere in the sent payload, so a nested field counts too. */
function fieldNames(sent: unknown): Set<string> {
  const names = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      names.add(key);
      walk(child);
    }
  };
  walk(sent);
  return names;
}

/** `categoryRules` → `category rules`, `sendWeekday` → `send weekday`. */
function words(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

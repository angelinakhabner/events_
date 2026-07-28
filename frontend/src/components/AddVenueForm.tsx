import { useState } from 'react';
import type { Category } from '@goin/shared';
import { categoryLabel } from '../lib/format';
import { trpc } from '../lib/trpc';

export const CATEGORIES: Category[] = ['cinema', 'theatre', 'exhibition', 'comedy', 'music', 'other'];

/** Languages we can label nicely; anything the probe detects outside this
 *  set still round-trips as a plain code via the "other" handling below. */
const LANGUAGES: { code: string; label: string }[] = [
  { code: 'pl', label: 'Polski' },
  { code: 'en', label: 'English' },
  { code: 'uk', label: 'Українська' },
  { code: 'de', label: 'Deutsch' },
  { code: 'cs', label: 'Čeština' },
  { code: 'lt', label: 'Lietuvių' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
];

export interface AddVenueInput {
  name: string;
  url: string;
  category: Category;
  language: string;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Guided add-venue flow: pick the page's language, paste any URL (no
 * pre-defined list — the checker tells you whether it can be scraped and
 * turns green), then tag it with a category. The name is suggested from the
 * page itself and stays editable.
 */
export function AddVenueForm({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (input: AddVenueInput) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [language, setLanguage] = useState('pl');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [checkedUrl, setCheckedUrl] = useState<string | null>(null);

  const check = trpc.my.venues.checkUrl.useMutation({
    onSuccess: (r) => {
      // Fill the name from the page unless the user already typed one.
      if (r.ok && r.title) setName((prev) => (prev.trim() ? prev : r.title!));
    },
  });

  const runCheck = () => {
    const target = url.trim();
    if (!target || target === checkedUrl || check.isPending) return;
    setCheckedUrl(target);
    check.mutate({ url: target });
  };

  const stepLabel = 'block text-xs uppercase tracking-widest text-muted mb-1';

  return (
    <form
      className="mb-8 border border-rule p-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!url.trim() || !category) return;
        onSubmit({
          name: name.trim() || hostnameOf(url.trim()),
          url: url.trim(),
          category,
          language,
        });
      }}
    >
      <p className="text-sm text-muted max-w-prose">
        Add any venue by its listing URL — nothing pre-defined. If someone already added the
        same URL, you&rsquo;ll share it; it&rsquo;s only scraped once for everyone.
      </p>

      <div>
        <label className={stepLabel} htmlFor="add-language">1 · Language of the venue&rsquo;s page</label>
        <select
          id="add-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="border border-rule bg-paper px-2 py-1 text-sm"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
          {LANGUAGES.some((l) => l.code === language) ? null : (
            <option value={language}>{language}</option>
          )}
        </select>
      </div>

      <div>
        <label className={stepLabel} htmlFor="add-url">2 · Venue page URL</label>
        <div className="flex flex-wrap gap-2">
          <input
            id="add-url" required type="url" value={url}
            onChange={(e) => { setUrl(e.target.value); setCheckedUrl(null); check.reset(); }}
            onBlur={runCheck}
            placeholder="https://venue.example/program"
            className="flex-1 min-w-[16rem] border border-rule bg-paper px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={runCheck}
            disabled={!url.trim() || check.isPending}
            className="text-sm text-muted hover:text-ink bg-transparent border border-rule px-3 py-1 cursor-pointer disabled:opacity-50"
          >
            {check.isPending ? 'Checking…' : 'Check'}
          </button>
        </div>
        {check.isPending ? (
          <p role="status" className="mt-2 text-sm text-muted">Checking whether the page can be scraped…</p>
        ) : null}
        {check.data ? (
          check.data.ok ? (
            <p role="status" className="mt-2 text-sm text-green-700">
              ✓ Scrapable
              {check.data.method === 'structured-data'
                ? ` — found ${check.data.eventCount} upcoming event${check.data.eventCount === 1 ? '' : 's'} in the page's structured data`
                : ' — the page has readable content the AI extractor can parse'}
            </p>
          ) : (
            <p role="status" className="mt-2 text-sm text-red-700">✗ {check.data.reason}</p>
          )
        ) : null}
        {check.error ? (
          <p role="status" className="mt-2 text-sm text-red-700">✗ Check failed: {check.error.message}</p>
        ) : null}
      </div>

      <fieldset>
        <legend className={stepLabel}>3 · Tag</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={
                category === c
                  ? 'border border-ink bg-ink text-paper px-3 py-1 text-sm cursor-pointer'
                  : 'border border-rule bg-transparent text-muted hover:text-ink px-3 py-1 text-sm cursor-pointer'
              }
            >
              {categoryLabel(c)}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label className={stepLabel} htmlFor="add-name">Name — suggested from the page, edit freely</label>
        <div className="flex flex-wrap gap-3">
          <input
            id="add-name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Filled in after the URL check"
            className="flex-1 min-w-[12rem] border border-rule bg-paper px-2 py-1 text-sm"
          />
          <button
            type="submit" disabled={submitting || !url.trim() || !category}
            className="link-accent text-sm bg-transparent border border-rule px-3 py-1 cursor-pointer disabled:opacity-50"
          >
            {submitting ? 'Adding…' : 'Add venue'}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </form>
  );
}

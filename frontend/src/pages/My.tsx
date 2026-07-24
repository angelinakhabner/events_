import { useMemo, useState } from 'react';
import type { Category } from '@goin/shared';
import { categoryLabel } from '../lib/format';
import { trpc } from '../lib/trpc';
import { clearSessionToken, isLoggedIn } from '../lib/auth';
import { MyFoldersPage } from './MyFolders';
import { EventList } from '../components/EventList';
import { FilmsSection } from '../components/FilmsSection';
import { NewsletterSection } from '../components/NewsletterSection';
import { ErrorState, SkeletonList } from '../components/states';

const CATEGORIES: Category[] = ['cinema', 'theatre', 'exhibition', 'comedy', 'music', 'other'];

/**
 * /my — the logged-in home: your venues (editable, with personal name/category
 * overrides and scrape window), custom venue adding, folders, and the
 * "want to go" list. Logged-out visitors get the magic-link login form.
 */
export function MyPage() {
  const loggedIn = isLoggedIn();
  const me = trpc.auth.me.useQuery(undefined, { enabled: loggedIn });

  if (!loggedIn || (me.isFetched && !me.data)) {
    return <LoginSection />;
  }
  return (
    <div className="space-y-16">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">My page</h1>
          {me.data ? <p className="mt-2 text-muted">{me.data.email}</p> : null}
        </div>
        <LogoutButton />
      </header>
      <MyVenuesSection />
      <WantToGoSection />
      <FilmsSection />
      <NewsletterSection defaultEmail={me.data?.email ?? ''} />
      <section>
        <MyFoldersPage />
      </section>
    </div>
  );
}

// ─── Login ───────────────────────────────────────────────────────────────────

function LoginSection() {
  const [email, setEmail] = useState('');
  const request = trpc.auth.requestLink.useMutation();
  const methods = trpc.auth.methods.useQuery();

  if (request.isSuccess) {
    return (
      <section className="mx-auto mt-16 max-w-sm text-center">
        <h1 className="font-serif text-3xl tracking-tight">Check your email</h1>
        <p className="mt-3 text-sm text-muted">
          {request.data.emailSent ? (
            <>
              We sent a sign-in link to <span className="text-ink">{email}</span>.
              <br />
              It&rsquo;s valid for 15 minutes and works once.
            </>
          ) : (
            'Email sending is not configured on this server — ask the operator for the login link from the server log.'
          )}
        </p>
        <button
          type="button"
          onClick={() => request.reset()}
          className="mt-8 text-sm text-muted hover:text-ink bg-transparent border-0 cursor-pointer underline underline-offset-4"
        >
          Use a different address
        </button>
      </section>
    );
  }

  return (
    <section className="mx-auto mt-16 max-w-sm">
      <div className="text-center">
        <h1 className="font-serif text-3xl tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted">Enter your email to receive a sign-in link</p>
      </div>

      <form
        className="mt-8 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) request.mutate({ email: email.trim() });
        }}
      >
        <label className="sr-only" htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded border border-rule bg-paper px-4 py-2.5 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={request.isPending}
          className="w-full rounded bg-accent/90 text-paper px-4 py-2.5 text-sm cursor-pointer border-0 hover:bg-accent disabled:opacity-50"
        >
          {request.isPending ? 'Sending…' : 'Continue with email'}
        </button>
      </form>
      {request.error ? (
        <p className="mt-3 text-center text-sm text-muted">{request.error.message}</p>
      ) : null}

      {methods.data?.google ? (
        <>
          <div className="mt-6 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-rule" aria-hidden />
            or
            <span className="h-px flex-1 bg-rule" aria-hidden />
          </div>
          <a
            href={`${import.meta.env.VITE_API_URL ?? ''}/auth/google`}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded border border-rule bg-paper px-4 py-2.5 text-sm text-ink no-underline hover:border-ink"
          >
            <GoogleMark />
            Sign in with Google
          </a>
        </>
      ) : null}

      <p className="mt-10 text-center text-xs text-muted">
        No password to remember — your venues, folders, films and &ldquo;want to go&rdquo; list
        live behind this sign-in.
      </p>
    </section>
  );
}

/** The four-colour Google "G", inline so the page stays asset-free. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function LogoutButton() {
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({
    onSettled: async () => {
      clearSessionToken();
      await utils.invalidate();
      window.location.assign('/');
    },
  });
  return (
    <button
      type="button"
      onClick={() => logout.mutate()}
      className="text-sm text-muted hover:text-ink bg-transparent border-0 cursor-pointer"
    >
      Log out
    </button>
  );
}

// ─── Lists ───────────────────────────────────────────────────────────────────

/**
 * Switcher over the user's venue lists ("Warsaw", "Poznan", …). The venues
 * below always show the active list; switching also tells the backend which
 * venues to keep scraping — inactive lists pause until you come back.
 */
function ListsBar() {
  const utils = trpc.useUtils();
  const listsQuery = trpc.my.lists.list.useQuery();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const invalidate = () => {
    utils.my.lists.list.invalidate();
    utils.my.venues.list.invalidate();
  };
  const setActive = trpc.my.lists.setActive.useMutation({ onSuccess: invalidate });
  const create = trpc.my.lists.create.useMutation({
    onSuccess: () => { invalidate(); setCreating(false); setNewName(''); },
  });
  const rename = trpc.my.lists.rename.useMutation({
    onSuccess: () => { invalidate(); setRenaming(false); },
  });
  const remove = trpc.my.lists.remove.useMutation({ onSuccess: invalidate });

  const lists = listsQuery.data ?? [];
  const active = lists.find((l) => l.active);
  const mutationError =
    setActive.error?.message ?? create.error?.message ?? rename.error?.message ?? remove.error?.message ?? null;

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-2">
        {lists.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={l.active}
            onClick={() => { if (!l.active) setActive.mutate({ listId: l.id }); }}
            disabled={setActive.isPending}
            className={
              l.active
                ? 'border border-ink bg-ink text-paper px-3 py-1 text-sm cursor-default'
                : 'border border-rule bg-transparent text-muted hover:text-ink px-3 py-1 text-sm cursor-pointer disabled:opacity-50'
            }
          >
            {l.name} <span className="opacity-70">({l.venueCount})</span>
          </button>
        ))}
        {creating ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate({ name: newName.trim() });
            }}
          >
            <label className="sr-only" htmlFor="new-list-name">List name</label>
            <input
              id="new-list-name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Poznan"
              className="border border-rule bg-paper px-2 py-1 text-sm"
            />
            <button type="submit" disabled={create.isPending} className="link-accent text-sm bg-transparent border-0 cursor-pointer disabled:opacity-50">
              Create
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName(''); }}
              className="text-sm text-muted hover:text-ink bg-transparent border-0 cursor-pointer"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="link-accent text-sm bg-transparent border-0 cursor-pointer">
            + New list
          </button>
        )}
      </div>

      {active ? (
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
          {renaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (renameValue.trim()) rename.mutate({ listId: active.id, name: renameValue.trim() });
              }}
            >
              <label className="sr-only" htmlFor="rename-list">New list name</label>
              <input
                id="rename-list"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="border border-rule bg-paper px-2 py-1 text-sm"
              />
              <button type="submit" disabled={rename.isPending} className="link-accent bg-transparent border-0 cursor-pointer disabled:opacity-50">
                Save
              </button>
              <button type="button" onClick={() => setRenaming(false)} className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer">
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => { setRenameValue(active.name); setRenaming(true); }}
              className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
            >
              Rename list
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete "${active.name}" and its ${active.venueCount} venue subscription(s)?`)) {
                remove.mutate({ listId: active.id });
              }
            }}
            className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer p-0"
          >
            Delete list
          </button>
        </div>
      ) : null}

      {mutationError ? <p className="mt-2 text-sm text-red-700">{mutationError}</p> : null}
      <p className="mt-3 text-xs text-muted max-w-prose">
        Only the list you&rsquo;re viewing is kept fresh — venues in your other lists aren&rsquo;t
        scraped until you switch to them.
      </p>
    </div>
  );
}

// ─── My venues ───────────────────────────────────────────────────────────────

function MyVenuesSection() {
  const utils = trpc.useUtils();
  const venuesQuery = trpc.my.venues.list.useQuery();
  const [adding, setAdding] = useState(false);

  const invalidate = () => utils.my.venues.list.invalidate();
  const update = trpc.my.venues.update.useMutation({ onSuccess: invalidate });
  const remove = trpc.my.venues.remove.useMutation({ onSuccess: invalidate });
  const add = trpc.my.venues.add.useMutation({
    onSuccess: () => { invalidate(); setAdding(false); },
  });

  const venueRows = venuesQuery.data;
  const grouped = useMemo(() => {
    const m = new Map<string, NonNullable<typeof venueRows>>();
    for (const v of venueRows ?? []) {
      const list = m.get(v.category) ?? [];
      list.push(v);
      m.set(v.category, list);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [venueRows]);

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h2 className="font-serif text-2xl tracking-tight">My venues</h2>
          <p className="mt-1 text-sm text-muted max-w-prose">
            Rename a venue or change its category — the change is only visible to you.
            The scrape window controls how far ahead events are collected.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="link-accent text-sm bg-transparent border-0 cursor-pointer"
        >
          {adding ? 'Cancel' : 'Add venue'}
        </button>
      </div>

      <ListsBar />

      {adding ? (
        <AddVenueForm
          onSubmit={(input) => add.mutate(input)}
          submitting={add.isPending}
          error={add.error?.message ?? null}
        />
      ) : null}

      {venuesQuery.isLoading ? <SkeletonList rows={4} /> : null}
      {venuesQuery.error ? (
        <ErrorState message="Couldn't load your venues." onRetry={() => venuesQuery.refetch()} />
      ) : null}
      {venueRows && venueRows.length === 0 ? (
        <p className="text-sm text-muted">
          No venues in this list yet — use &ldquo;Add venue&rdquo; to add one by URL.
        </p>
      ) : null}

      {grouped.map(([category, list]) => (
        <div key={category} className="mb-8">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">{category}</h3>
          <ul className="divide-y divide-rule border-y border-rule">
            {list.map((v) => (
              <VenueRow
                key={v.id}
                venue={v}
                onSave={(patch) => update.mutate({ venueId: v.id, ...patch })}
                onRemove={() => remove.mutate({ venueId: v.id })}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

interface VenueRowVenue {
  id: string;
  name: string;
  url: string;
  category: Category;
  windowDays: number | null;
  customized: boolean;
}

function VenueRow({
  venue,
  onSave,
  onRemove,
}: {
  venue: VenueRowVenue;
  onSave: (patch: { name?: string; category?: Category; windowDays?: number | null }) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(venue.name);
  const [category, setCategory] = useState<Category>(venue.category);
  const [windowDays, setWindowDays] = useState<string>(venue.windowDays?.toString() ?? '');

  const save = () => {
    const patch: { name?: string; category?: Category; windowDays?: number | null } = {};
    if (name.trim() && name.trim() !== venue.name) patch.name = name.trim();
    if (category !== venue.category) patch.category = category;
    const w = windowDays === '' ? null : Number(windowDays);
    if (w !== venue.windowDays && (w === null || (Number.isInteger(w) && w >= 1 && w <= 90))) {
      patch.windowDays = w;
    }
    if (Object.keys(patch).length) onSave(patch);
    setEditing(false);
  };

  if (!editing) {
    return (
      <li className="flex items-baseline justify-between gap-4 py-3">
        <div className="min-w-0">
          <span className="text-ink">{venue.name}</span>
          {venue.customized ? <span className="ml-2 text-xs text-muted">(edited)</span> : null}
          <span className="ml-3 text-xs text-muted">
            {venue.windowDays ? `${venue.windowDays}d window` : 'default window'}
          </span>
        </div>
        <div className="flex shrink-0 gap-4 text-sm">
          <button type="button" onClick={() => setEditing(true)} className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer">
            Edit
          </button>
          <button type="button" onClick={onRemove} className="text-muted hover:text-ink bg-transparent border-0 cursor-pointer">
            Remove
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor={`name-${venue.id}`}>Name</label>
        <input
          id={`name-${venue.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 min-w-[12rem] border border-rule bg-paper px-2 py-1 text-sm"
        />
        <label className="sr-only" htmlFor={`category-${venue.id}`}>Category</label>
        <select
          id={`category-${venue.id}`}
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="border border-rule bg-paper px-2 py-1 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="text-xs text-muted" htmlFor={`window-${venue.id}`}>
          window (days)
        </label>
        <input
          id={`window-${venue.id}`}
          type="number"
          min={1}
          max={90}
          value={windowDays}
          onChange={(e) => setWindowDays(e.target.value)}
          placeholder="default"
          className="w-20 border border-rule bg-paper px-2 py-1 text-sm"
        />
        <button type="button" onClick={save} className="link-accent text-sm bg-transparent border-0 cursor-pointer">
          Save
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setName(venue.name); setCategory(venue.category); }}
          className="text-sm text-muted hover:text-ink bg-transparent border-0 cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </li>
  );
}

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

// ─── Want to go ──────────────────────────────────────────────────────────────

function WantToGoSection() {
  const q = trpc.my.wantToGo.list.useQuery();
  return (
    <section>
      <h2 className="mb-6 font-serif text-2xl tracking-tight">Want to go</h2>
      {q.isLoading ? <SkeletonList rows={2} /> : null}
      {q.error ? <ErrorState message="Couldn't load your list." onRetry={() => q.refetch()} /> : null}
      {q.data && q.data.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing saved yet — use &ldquo;Want to go&rdquo; on any event.
        </p>
      ) : null}
      {q.data && q.data.length > 0 ? <EventList events={q.data} venues={new Map()} /> : null}
    </section>
  );
}

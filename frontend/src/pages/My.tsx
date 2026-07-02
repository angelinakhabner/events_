import { useMemo, useState } from 'react';
import type { Category } from '@goin/shared';
import { trpc } from '../lib/trpc';
import { clearSessionToken, isLoggedIn } from '../lib/auth';
import { MyFoldersPage } from './MyFolders';
import { EventList } from '../components/EventList';
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

  if (request.isSuccess) {
    return (
      <section className="max-w-prose">
        <h1 className="font-serif text-4xl tracking-tight">Check your email</h1>
        <p className="mt-4 text-muted">
          {request.data.emailSent
            ? `We sent a login link to ${email}. It's valid for 15 minutes.`
            : 'Email sending is not configured on this server — ask the operator for the login link from the server log.'}
        </p>
      </section>
    );
  }

  return (
    <section className="max-w-prose">
      <h1 className="font-serif text-4xl tracking-tight">Log in</h1>
      <p className="mt-2 text-muted">
        Your venues, folders and &ldquo;want to go&rdquo; list live behind a passwordless login.
      </p>
      <form
        className="mt-6 flex gap-3"
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1 border border-rule bg-paper px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={request.isPending}
          className="link-accent text-sm bg-transparent border border-rule px-4 py-2 cursor-pointer disabled:opacity-50"
        >
          {request.isPending ? 'Sending…' : 'Send login link'}
        </button>
      </form>
      {request.error ? <p className="mt-3 text-sm text-muted">{request.error.message}</p> : null}
    </section>
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

function AddVenueForm({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (input: { name: string; url: string; category: Category; windowDays?: number | null }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<Category>('other');
  const [windowDays, setWindowDays] = useState('');

  return (
    <form
      className="mb-8 border border-rule p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name: name.trim(),
          url: url.trim(),
          category,
          windowDays: windowDays === '' ? null : Number(windowDays),
        });
      }}
    >
      <p className="mb-3 text-sm text-muted">
        If someone already added this venue (same URL), you&rsquo;ll share it — it&rsquo;s only scraped once for everyone.
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="add-name">Venue name</label>
        <input
          id="add-name" required value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Venue name" className="flex-1 min-w-[10rem] border border-rule bg-paper px-2 py-1 text-sm"
        />
        <label className="sr-only" htmlFor="add-url">Listing URL</label>
        <input
          id="add-url" required type="url" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://venue.example/program" className="flex-[2] min-w-[16rem] border border-rule bg-paper px-2 py-1 text-sm"
        />
        <label className="sr-only" htmlFor="add-category">Category</label>
        <select
          id="add-category" value={category} onChange={(e) => setCategory(e.target.value as Category)}
          className="border border-rule bg-paper px-2 py-1 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="add-window">Scrape window (days)</label>
        <input
          id="add-window" type="number" min={1} max={90} value={windowDays}
          onChange={(e) => setWindowDays(e.target.value)} placeholder="window (days)"
          className="w-32 border border-rule bg-paper px-2 py-1 text-sm"
        />
        <button
          type="submit" disabled={submitting}
          className="link-accent text-sm bg-transparent border border-rule px-3 py-1 cursor-pointer disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-muted">{error}</p> : null}
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

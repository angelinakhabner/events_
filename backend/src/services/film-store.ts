import { and, asc, eq, sql } from 'drizzle-orm';
import type { Film, FilmStatus } from '@afisz/shared';
import { getDb, schema } from '../db/index.js';

// Personal film lists (GOI-5): titles a user wants to watch, and titles
// they've seen (with where + a short comment). Screenings for a "want" title
// come from the existing events.screenings procedure — this store only owns
// the titles themselves.

export interface SeenDetails {
  watchedVenue?: string | null;
  comment?: string | null;
}

export interface FilmStore {
  /** All of the user's films, want-list first, each group oldest-added first. */
  list(userId: string): Promise<Film[]>;
  /** Add a title to the want list. Throws "You already have ..." on duplicates. */
  add(userId: string, title: string): Promise<Film>;
  /** Move a film to "seen", recording where and a short note. */
  markSeen(userId: string, filmId: string, details: SeenDetails): Promise<Film>;
  /** Move a film back to the want list, clearing the seen details. */
  moveToWant(userId: string, filmId: string): Promise<Film>;
  remove(userId: string, filmId: string): Promise<boolean>;
}

type FilmRow = typeof schema.films.$inferSelect;

function toFilm(row: FilmRow): Film {
  return {
    id: row.id,
    title: row.title,
    status: row.status as FilmStatus,
    watchedVenue: row.watchedVenue,
    comment: row.comment,
    watchedAt: row.watchedAt ? row.watchedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class DbFilmStore implements FilmStore {
  async list(userId: string): Promise<Film[]> {
    const rows = await getDb()
      .select()
      .from(schema.films)
      .where(eq(schema.films.userId, userId))
      .orderBy(asc(schema.films.createdAt));
    const films = rows.map(toFilm);
    return [...films.filter((f) => f.status === 'want'), ...films.filter((f) => f.status !== 'want')];
  }

  async add(userId: string, title: string): Promise<Film> {
    const clean = title.trim();
    const [existing] = await getDb()
      .select({ id: schema.films.id })
      .from(schema.films)
      .where(and(eq(schema.films.userId, userId), sql`lower(${schema.films.title}) = lower(${clean})`))
      .limit(1);
    if (existing) throw new Error(`You already have "${clean}" in your films`);
    const [row] = await getDb()
      .insert(schema.films)
      .values({ userId, title: clean, status: 'want' })
      .returning();
    return toFilm(row!);
  }

  async markSeen(userId: string, filmId: string, details: SeenDetails): Promise<Film> {
    const [row] = await getDb()
      .update(schema.films)
      .set({
        status: 'seen',
        watchedVenue: details.watchedVenue?.trim() || null,
        comment: details.comment?.trim() || null,
        watchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.films.id, filmId), eq(schema.films.userId, userId)))
      .returning();
    if (!row) throw new Error(`Film ${filmId} not found`);
    return toFilm(row);
  }

  async moveToWant(userId: string, filmId: string): Promise<Film> {
    const [row] = await getDb()
      .update(schema.films)
      .set({ status: 'want', watchedVenue: null, comment: null, watchedAt: null, updatedAt: new Date() })
      .where(and(eq(schema.films.id, filmId), eq(schema.films.userId, userId)))
      .returning();
    if (!row) throw new Error(`Film ${filmId} not found`);
    return toFilm(row);
  }

  async remove(userId: string, filmId: string): Promise<boolean> {
    const rows = await getDb()
      .delete(schema.films)
      .where(and(eq(schema.films.id, filmId), eq(schema.films.userId, userId)))
      .returning({ id: schema.films.id });
    return rows.length > 0;
  }
}

// In-memory variant for tests / no DATABASE_URL. Fully functional — films
// don't need an events join, so the behaviour matches the DB store.
export class InMemoryFilmStore implements FilmStore {
  private byUser = new Map<string, Film[]>();
  private nextId = 1;

  private filmsFor(userId: string): Film[] {
    let list = this.byUser.get(userId);
    if (!list) this.byUser.set(userId, (list = []));
    return list;
  }

  async list(userId: string): Promise<Film[]> {
    const films = this.filmsFor(userId);
    return [...films.filter((f) => f.status === 'want'), ...films.filter((f) => f.status !== 'want')];
  }

  async add(userId: string, title: string): Promise<Film> {
    const clean = title.trim();
    const films = this.filmsFor(userId);
    if (films.some((f) => f.title.toLowerCase() === clean.toLowerCase())) {
      throw new Error(`You already have "${clean}" in your films`);
    }
    const film: Film = {
      id: `film-${this.nextId++}`,
      title: clean,
      status: 'want',
      watchedVenue: null,
      comment: null,
      watchedAt: null,
      createdAt: new Date().toISOString(),
    };
    films.push(film);
    return film;
  }

  async markSeen(userId: string, filmId: string, details: SeenDetails): Promise<Film> {
    const film = this.filmsFor(userId).find((f) => f.id === filmId);
    if (!film) throw new Error(`Film ${filmId} not found`);
    film.status = 'seen';
    film.watchedVenue = details.watchedVenue?.trim() || null;
    film.comment = details.comment?.trim() || null;
    film.watchedAt = new Date().toISOString();
    return film;
  }

  async moveToWant(userId: string, filmId: string): Promise<Film> {
    const film = this.filmsFor(userId).find((f) => f.id === filmId);
    if (!film) throw new Error(`Film ${filmId} not found`);
    film.status = 'want';
    film.watchedVenue = null;
    film.comment = null;
    film.watchedAt = null;
    return film;
  }

  async remove(userId: string, filmId: string): Promise<boolean> {
    const films = this.filmsFor(userId);
    const idx = films.findIndex((f) => f.id === filmId);
    if (idx === -1) return false;
    films.splice(idx, 1);
    return true;
  }
}

export const defaultFilmStore: FilmStore = process.env.DATABASE_URL
  ? new DbFilmStore()
  : new InMemoryFilmStore();

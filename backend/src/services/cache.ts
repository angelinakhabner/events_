export const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache<T> {
  private store = new Map<string, Entry<T>>();
  constructor(private ttlMs: number = CACHE_TTL_MS, private now: () => number = Date.now) {}

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  size(): number {
    return this.store.size;
  }
}

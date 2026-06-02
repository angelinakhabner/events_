import { describe, it, expect, beforeEach } from 'vitest';
import { getDeviceId } from './device-id';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(k: string): string | null { return this.store.get(k) ?? null; }
  setItem(k: string, v: string): void { this.store.set(k, v); }
  removeItem(k: string): void { this.store.delete(k); }
  key(i: number): string | null { return [...this.store.keys()][i] ?? null; }
}

describe('getDeviceId', () => {
  let storage: MemoryStorage;
  beforeEach(() => { storage = new MemoryStorage(); });

  it('generates a UUID on first call and persists it', () => {
    const id = getDeviceId(storage);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(storage.getItem('goin_device_id')).toBe(id);
  });

  it('returns the persisted id on subsequent calls', () => {
    const first = getDeviceId(storage);
    const second = getDeviceId(storage);
    expect(second).toBe(first);
  });
});

import { describe, it, expect } from 'vitest';
import { TTLCache } from './cache.js';

describe('TTLCache', () => {
  it('returns stored value before expiry', () => {
    let t = 0;
    const c = new TTLCache<string>(1000, () => t);
    c.set('k', 'v');
    t = 500;
    expect(c.get('k')).toBe('v');
  });

  it('evicts after TTL elapses', () => {
    let t = 0;
    const c = new TTLCache<string>(1000, () => t);
    c.set('k', 'v');
    t = 2000;
    expect(c.get('k')).toBeUndefined();
    expect(c.size()).toBe(0);
  });
});

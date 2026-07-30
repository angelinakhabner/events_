import { describe, it, expect, vi, afterEach } from 'vitest';
import { onnotice } from './notices.js';

describe('onnotice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops the notices idempotent DDL raises on a replayed migration', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Exactly what `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
    // produce once the schema is already in place — every boot, ~290 lines
    // worth once the driver pretty-prints them.
    onnotice({ severity: 'NOTICE', code: '42P07', message: 'relation "venues" already exists, skipping' });
    onnotice({ severity: 'NOTICE', code: '42701', message: 'column "timezone" of relation "venues" already exists, skipping' });
    onnotice({ severity: 'NOTICE', code: '42710', message: 'constraint "events_pkey" already exists, skipping' });
    onnotice({ severity: 'NOTICE', code: '42P01', message: 'table "gone" does not exist, skipping' });

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('still surfaces an unexpected notice, on one line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    onnotice({ severity: 'NOTICE', code: '01000', message: 'something worth knowing' });

    expect(log).toHaveBeenCalledTimes(1);
    const [line] = log.mock.calls[0]!;
    expect(line).toBe('[pg] NOTICE 01000: something worth knowing');
    expect(String(line)).not.toContain('\n');
  });

  it('routes warnings to console.warn', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    onnotice({ severity: 'WARNING', code: '01000', message: 'deprecated syntax' });

    expect(warn).toHaveBeenCalledWith('[pg] WARNING 01000: deprecated syntax');
    expect(log).not.toHaveBeenCalled();
  });

  it('tolerates a notice with no code or message', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    onnotice({});

    expect(log).toHaveBeenCalledWith('[pg] NOTICE -: (no message)');
  });
});

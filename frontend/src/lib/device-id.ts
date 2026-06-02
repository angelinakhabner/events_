const KEY = 'goin_device_id';

export function getDeviceId(storage: Storage = localStorage): string {
  let id: string | null = null;
  try {
    id = storage.getItem(KEY);
  } catch {
    // localStorage can throw in private mode; fall through to in-memory.
  }
  if (id && id.length > 0) return id;
  const fresh = (globalThis.crypto?.randomUUID?.() ?? fallbackUuid());
  try {
    storage.setItem(KEY, fresh);
  } catch {
    // Ignore; the id will be regenerated next call. Fine for an MVP.
  }
  return fresh;
}

function fallbackUuid(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b, i) => {
      if (i === 6) b = (b & 0x0f) | 0x40;
      if (i === 8) b = (b & 0x3f) | 0x80;
      return b.toString(16).padStart(2, '0');
    })
    .join('')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

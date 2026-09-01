import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Dropbox as a drive provider (GOI-93).
 *
 * Like the Google suite, every case drives the real client through an injected
 * `fetch`, so what Dropbox would actually receive is the thing under test.
 * That matters more here than it did for Google: Dropbox addresses files by
 * path, passes call arguments in an HTTP header, and answers several unrelated
 * conditions with the same 409 — three chances to be plausibly wrong in a way
 * only a real request shape catches.
 */
const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.DROPBOX_CLIENT_ID = 'client-id';
  process.env.DROPBOX_CLIENT_SECRET = 'client-secret';
  process.env.API_PUBLIC_URL = 'https://api.afisz.cc';
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function stubFetch(routes: { match: RegExp; reply: () => Response }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find((r) => r.match.test(url));
    if (!route) throw new Error(`unstubbed fetch: ${url}`);
    return route.reply();
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const TOKEN_OK = {
  match: /api\.dropboxapi\.com\/oauth2\/token/,
  reply: () => json({ access_token: 'at-1' }),
};

/** The argument JSON a content-endpoint call carried, read back off the header. */
function apiArgOf(init: RequestInit | undefined): Record<string, unknown> {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return JSON.parse(headers['Dropbox-API-Arg'] ?? '{}') as Record<string, unknown>;
}

/** The JSON body an RPC call carried. */
function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

describe('dropboxDriveAuthUrl', () => {
  it('asks for offline access, without which there is no refresh token', async () => {
    const { dropboxDriveAuthUrl, dropboxDriveConfig } = await import('./dropbox-drive.js');
    const url = new URL(dropboxDriveAuthUrl(dropboxDriveConfig()!, 'state-1'));

    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(url.searchParams.get('token_access_type')).toBe('offline');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('redirect_uri'))
      .toBe('https://api.afisz.cc/auth/dropbox/drive/callback');
  });
});

describe('dropboxDriveConfig', () => {
  it('is null when the deployment has no Dropbox credentials', async () => {
    delete process.env.DROPBOX_CLIENT_SECRET;
    vi.resetModules();
    const { dropboxDriveConfig } = await import('./dropbox-drive.js');
    expect(dropboxDriveConfig()).toBeNull();
  });

  /** Google's presence must not imply Dropbox's — a deployment can have either. */
  it('is independent of the Google credentials', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    vi.resetModules();
    const { dropboxDriveConfig } = await import('./dropbox-drive.js');
    expect(dropboxDriveConfig()).not.toBeNull();
  });
});

describe('exchangeDropboxCode', () => {
  it('refuses a grant that came back without a refresh token', async () => {
    const { exchangeDropboxCode, dropboxDriveConfig } = await import('./dropbox-drive.js');
    const { fetcher } = stubFetch([
      { match: /oauth2\/token/, reply: () => json({ access_token: 'at-1' }) },
    ]);
    // A connection that cannot refresh works for four hours and then stops
    // filing briefs with nothing to point at, so this fails at connect time.
    await expect(exchangeDropboxCode(dropboxDriveConfig()!, 'code-1', { fetcher }))
      .rejects.toThrow(/no refresh token/);
  });

  it('returns the refresh token when the grant is complete', async () => {
    const { exchangeDropboxCode, dropboxDriveConfig } = await import('./dropbox-drive.js');
    const { fetcher, calls } = stubFetch([
      {
        match: /oauth2\/token/,
        reply: () => json({ access_token: 'at-1', refresh_token: 'rt-1' }),
      },
    ]);
    const tokens = await exchangeDropboxCode(dropboxDriveConfig()!, 'code-1', { fetcher });

    expect(tokens).toEqual({ refreshToken: 'rt-1', accessToken: 'at-1', email: null });
    expect(String(calls[0]!.init!.body)).toContain('grant_type=authorization_code');
  });
});

describe('refreshDropboxToken', () => {
  it('says the grant was revoked rather than printing a status', async () => {
    const { refreshDropboxToken, dropboxDriveConfig } = await import('./dropbox-drive.js');
    const { fetcher } = stubFetch([
      { match: /oauth2\/token/, reply: () => json({ error: 'invalid_grant' }, 400) },
    ]);
    await expect(refreshDropboxToken(dropboxDriveConfig()!, 'rt-1', fetcher))
      .rejects.toThrow(/revoked — reconnect it/);
  });
});

describe('dropboxDriveProvider.ensureFolder', () => {
  it('creates the folder when there is no stored id', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { fetcher, calls } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/create_folder_v2/,
        reply: () => json({ metadata: { id: 'id:abc', path_lower: '/briefs' } }),
      },
    ]);

    const out = await dropboxDriveProvider.ensureFolder({
      refreshToken: 'rt-1', folderName: 'Briefs', fetcher,
    });

    expect(out).toEqual({ folderId: 'id:abc', created: true });
    const create = calls.find((c) => c.url.includes('create_folder_v2'))!;
    expect(bodyOf(create.init)).toEqual({ path: '/Briefs', autorename: false });
  });

  /**
   * The stored id is an `id:…`, never the path — this is the load-bearing
   * choice in the whole file. `renameFolder` does not hand a new id back and
   * the store keeps the old one, so a path stored here would be stale the
   * moment the folder is renamed, and briefs would be filed into a folder the
   * user stopped looking at.
   */
  it('stores an id, not a path, so it survives a rename', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { fetcher } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/create_folder_v2/,
        reply: () => json({ metadata: { id: 'id:abc', path_lower: '/briefs' } }),
      },
    ]);
    const out = await dropboxDriveProvider.ensureFolder({
      refreshToken: 'rt-1', folderName: 'Briefs', fetcher,
    });
    expect(out.folderId).toMatch(/^id:/);
  });

  it('reuses a stored id without creating anything', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { fetcher, calls } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/get_metadata/,
        reply: () => json({ '.tag': 'folder', id: 'id:abc', path_lower: '/briefs' }),
      },
    ]);

    const out = await dropboxDriveProvider.ensureFolder({
      refreshToken: 'rt-1', folderName: 'Briefs', knownFolderId: 'id:abc', fetcher,
    });

    expect(out).toEqual({ folderId: 'id:abc', created: false });
    expect(calls.some((c) => c.url.includes('create_folder_v2'))).toBe(false);
  });

  /** The user deleted it. Recreate rather than upload into nothing. */
  it('recreates when the stored id is gone', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { fetcher } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/get_metadata/,
        reply: () => json({ error_summary: 'path/not_found/..' }, 409),
      },
      {
        match: /files\/create_folder_v2/,
        reply: () => json({ metadata: { id: 'id:new', path_lower: '/briefs' } }),
      },
    ]);

    const out = await dropboxDriveProvider.ensureFolder({
      refreshToken: 'rt-1', folderName: 'Briefs', knownFolderId: 'id:old', fetcher,
    });
    expect(out).toEqual({ folderId: 'id:new', created: true });
  });

  /**
   * Dropbox answers "already exists" with the same 409 it uses for "not
   * found", which is why the client matches on `error_summary`. Adopting the
   * existing folder beats `autorename`, which would silently start filing into
   * "Briefs (1)".
   */
  it('adopts a folder that is already there instead of autorenaming', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { fetcher } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/create_folder_v2/,
        reply: () => json({ error_summary: 'path/conflict/folder/..' }, 409),
      },
      {
        match: /files\/get_metadata/,
        reply: () => json({ '.tag': 'folder', id: 'id:existing', path_lower: '/briefs' }),
      },
    ]);

    const out = await dropboxDriveProvider.ensureFolder({
      refreshToken: 'rt-1', folderName: 'Briefs', fetcher,
    });
    expect(out).toEqual({ folderId: 'id:existing', created: false });
  });

  /** Dropbox rejects these outright, so they never reach the API. */
  it('strips characters Dropbox will not accept in a name', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { fetcher, calls } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/create_folder_v2/,
        reply: () => json({ metadata: { id: 'id:abc', path_lower: '/x' } }),
      },
    ]);

    await dropboxDriveProvider.ensureFolder({
      refreshToken: 'rt-1', folderName: 'A/B:C?D', fetcher,
    });
    const create = calls.find((c) => c.url.includes('create_folder_v2'))!;
    expect(bodyOf(create.init).path).toBe('/A-B-C-D');
  });
});

describe('dropboxDriveProvider.upload', () => {
  it('resolves the id to a path and uploads into it', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { fetcher, calls } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/get_metadata/,
        reply: () => json({ '.tag': 'folder', id: 'id:abc', path_lower: '/briefs' }),
      },
      { match: /files\/upload/, reply: () => json({ id: 'id:file-1' }) },
    ]);

    const out = await dropboxDriveProvider.upload({
      refreshToken: 'rt-1',
      folderId: 'id:abc',
      file: { filename: 'afisz-brief.pdf', contentType: 'application/pdf', body: Buffer.from('x') },
      fetcher,
    });

    expect(out).toEqual({ fileId: 'id:file-1', webUrl: null });
    const upload = calls.find((c) => c.url.includes('files/upload'))!;
    const arg = apiArgOf(upload.init);
    expect(arg.path).toBe('/briefs/afisz-brief.pdf');
    // Never overwrite: two briefs on one day is odd, losing the first is worse.
    expect(arg.mode).toBe('add');
    expect(arg.autorename).toBe(true);
  });

  /**
   * `Dropbox-API-Arg` is an HTTP header, and headers are ASCII. A folder named
   * in Polish would otherwise fail the upload with a header parse error a day
   * after the user set it — the one bug in this file that would never show up
   * in an English-language test.
   */
  it('escapes non-ASCII in the header argument', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { fetcher, calls } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/get_metadata/,
        reply: () => json({ '.tag': 'folder', id: 'id:abc', path_lower: '/wrzesień' }),
      },
      { match: /files\/upload/, reply: () => json({ id: 'id:file-1' }) },
    ]);

    await dropboxDriveProvider.upload({
      refreshToken: 'rt-1',
      folderId: 'id:abc',
      file: { filename: 'brief.pdf', contentType: 'application/pdf', body: Buffer.from('x') },
      fetcher,
    });

    const upload = calls.find((c) => c.url.includes('files/upload'))!;
    const raw = ((upload.init!.headers ?? {}) as Record<string, string>)['Dropbox-API-Arg']!;
    // eslint-disable-next-line no-control-regex
    expect(raw).toMatch(/^[\x00-\x7F]*$/);
    expect(raw).toContain('\\u0144'); // ń
    // …and it still parses back to the real path.
    expect(apiArgOf(upload.init).path).toBe('/wrzesień/brief.pdf');
  });

  it('reports a deleted folder as missing, so the caller can recreate it', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { DriveFolderMissingError } = await import('./cloud-drive.js');
    const { fetcher } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/get_metadata/,
        reply: () => json({ error_summary: 'path/not_found/..' }, 409),
      },
    ]);

    await expect(dropboxDriveProvider.upload({
      refreshToken: 'rt-1',
      folderId: 'id:gone',
      file: { filename: 'b.pdf', contentType: 'application/pdf', body: Buffer.from('x') },
      fetcher,
    })).rejects.toBeInstanceOf(DriveFolderMissingError);
  });
});

describe('dropboxDriveProvider.renameFolder', () => {
  it('moves the folder, keeping the briefs already in it', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { fetcher, calls } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/get_metadata/,
        reply: () => json({ '.tag': 'folder', id: 'id:abc', path_lower: '/old' }),
      },
      { match: /files\/move_v2/, reply: () => json({ metadata: { id: 'id:abc' } }) },
    ]);

    await dropboxDriveProvider.renameFolder({
      refreshToken: 'rt-1', folderId: 'id:abc', name: 'New', fetcher,
    });

    const move = calls.find((c) => c.url.includes('move_v2'))!;
    expect(bodyOf(move.init)).toEqual({ from_path: '/old', to_path: '/New', autorename: false });
  });

  it('reports a missing folder as missing rather than as a failed rename', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { DriveFolderMissingError } = await import('./cloud-drive.js');
    const { fetcher } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/get_metadata/,
        reply: () => json({ error_summary: 'path/not_found/..' }, 409),
      },
    ]);

    await expect(dropboxDriveProvider.renameFolder({
      refreshToken: 'rt-1', folderId: 'id:gone', name: 'New', fetcher,
    })).rejects.toBeInstanceOf(DriveFolderMissingError);
  });

  it('names the clash when a folder of that name is already there', async () => {
    const { dropboxDriveProvider } = await import('./dropbox-drive.js');
    const { fetcher } = stubFetch([
      TOKEN_OK,
      {
        match: /files\/get_metadata/,
        reply: () => json({ '.tag': 'folder', id: 'id:abc', path_lower: '/old' }),
      },
      { match: /files\/move_v2/, reply: () => json({ error_summary: 'to/conflict/folder/..' }, 409) },
    ]);

    await expect(dropboxDriveProvider.renameFolder({
      refreshToken: 'rt-1', folderId: 'id:abc', name: 'Taken', fetcher,
    })).rejects.toThrow(/already in your Dropbox/);
  });
});

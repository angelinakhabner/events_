import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Every case here drives the real client through an injected `fetch`, so the
 * request shapes Google actually receives are the thing under test — a mocked
 * provider would assert nothing about them.
 */
const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  process.env.API_PUBLIC_URL = 'https://api.afisz.cc';
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

/** A fetch stub that answers by URL, recording every call. */
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

const TOKEN_OK = { match: /oauth2\.googleapis\.com\/token/, reply: () => json({ access_token: 'at-1' }) };

describe('googleDriveAuthUrl', () => {
  it('asks for offline access and forces the consent screen', async () => {
    const { googleDriveAuthUrl, googleDriveConfig, DRIVE_SCOPE } = await import('./google-drive.js');
    const url = new URL(googleDriveAuthUrl(googleDriveConfig()!, 'state-123'));

    // Without both of these Google returns no refresh token on a re-connect,
    // and a scheduled upload has nothing to refresh with.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toContain(DRIVE_SCOPE);
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.afisz.cc/auth/google/drive/callback');
  });

  it('requests drive.file, never the full drive scope', async () => {
    const { DRIVE_SCOPE } = await import('./google-drive.js');
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });
});

describe('exchangeDriveCode', () => {
  it('returns the refresh token and the account email', async () => {
    const { exchangeDriveCode, googleDriveConfig } = await import('./google-drive.js');
    const idToken = `x.${Buffer.from(JSON.stringify({ email: 'ada@example.com' })).toString('base64url')}.y`;
    const { fetcher } = stubFetch([
      {
        match: /token/,
        reply: () => json({ access_token: 'at', refresh_token: 'rt', id_token: idToken, scope: `openid https://www.googleapis.com/auth/drive.file` }),
      },
    ]);

    const tokens = await exchangeDriveCode(googleDriveConfig()!, 'code-1', { fetcher });
    expect(tokens.refreshToken).toBe('rt');
    expect(tokens.email).toBe('ada@example.com');
  });

  /**
   * The failure this guards against is silent: the connection looks fine and
   * then cannot upload anything an hour later, when the access token expires.
   */
  it('refuses a grant that came back without a refresh token', async () => {
    const { exchangeDriveCode, googleDriveConfig } = await import('./google-drive.js');
    const { fetcher } = stubFetch([{ match: /token/, reply: () => json({ access_token: 'at' }) }]);

    await expect(exchangeDriveCode(googleDriveConfig()!, 'code-1', { fetcher }))
      .rejects.toThrow(/no refresh token/i);
  });

  it('refuses a grant where the user unticked the Drive permission', async () => {
    const { exchangeDriveCode, googleDriveConfig } = await import('./google-drive.js');
    const { fetcher } = stubFetch([
      { match: /token/, reply: () => json({ access_token: 'at', refresh_token: 'rt', scope: 'openid email' }) },
    ]);

    await expect(exchangeDriveCode(googleDriveConfig()!, 'code-1', { fetcher }))
      .rejects.toThrow(/permission was not granted/i);
  });
});

describe('refreshAccessToken', () => {
  it('tells the user to reconnect when the grant was revoked', async () => {
    const { refreshAccessToken, googleDriveConfig } = await import('./google-drive.js');
    const { fetcher } = stubFetch([{ match: /token/, reply: () => json({ error: 'invalid_grant' }, 400) }]);

    await expect(refreshAccessToken(googleDriveConfig()!, 'rt', fetcher))
      .rejects.toThrow(/revoked — reconnect/i);
  });
});

describe('googleDriveProvider.ensureFolder', () => {
  it('reuses a stored folder id without searching', async () => {
    const { googleDriveProvider } = await import('./google-drive.js');
    const { fetcher, calls } = stubFetch([
      TOKEN_OK,
      { match: /drive\/v3\/files\/folder-1/, reply: () => json({ id: 'folder-1', trashed: false }) },
    ]);

    const out = await googleDriveProvider.ensureFolder({
      refreshToken: 'rt', folderName: 'Afisz.ka', knownFolderId: 'folder-1', fetcher,
    });

    expect(out).toEqual({ folderId: 'folder-1', created: false });
    expect(calls.some((c) => c.url.includes('q='))).toBe(false);
  });

  /**
   * A trashed folder still accepts uploads, so trusting the stored id would
   * file every brief somewhere the user will never look.
   */
  it('replaces a stored folder the user has binned', async () => {
    const { googleDriveProvider } = await import('./google-drive.js');
    const { fetcher } = stubFetch([
      TOKEN_OK,
      { match: /drive\/v3\/files\/folder-1/, reply: () => json({ id: 'folder-1', trashed: true }) },
      { match: /drive\/v3\/files\?q=/, reply: () => json({ files: [] }) },
      { match: /drive\/v3\/files\?fields=id/, reply: () => json({ id: 'folder-2' }) },
    ]);

    const out = await googleDriveProvider.ensureFolder({
      refreshToken: 'rt', folderName: 'Afisz.ka', knownFolderId: 'folder-1', fetcher,
    });
    expect(out).toEqual({ folderId: 'folder-2', created: true });
  });

  it('finds an existing folder by name before creating one', async () => {
    const { googleDriveProvider } = await import('./google-drive.js');
    const { fetcher, calls } = stubFetch([
      TOKEN_OK,
      { match: /drive\/v3\/files\?q=/, reply: () => json({ files: [{ id: 'found' }] }) },
    ]);

    const out = await googleDriveProvider.ensureFolder({
      refreshToken: 'rt', folderName: 'Afisz.ka', fetcher,
    });
    expect(out).toEqual({ folderId: 'found', created: false });
    expect(calls.some((c) => c.init?.method === 'POST' && c.url.includes('fields=id'))).toBe(false);
  });

  /** Drive's query language has no escape for `'`, and the folder name is
   *  user-supplied — an unescaped quote breaks out of the literal. */
  it('escapes a quote in the folder name', async () => {
    const { googleDriveProvider } = await import('./google-drive.js');
    const { fetcher, calls } = stubFetch([
      TOKEN_OK,
      { match: /drive\/v3\/files\?q=/, reply: () => json({ files: [{ id: 'ok' }] }) },
    ]);

    await googleDriveProvider.ensureFolder({ refreshToken: 'rt', folderName: "Ala's drive", fetcher });

    const search = calls.find((c) => c.url.includes('q='))!;
    const q = new URL(search.url).searchParams.get('q')!;
    expect(q).toContain("name='Ala\\'s drive'");
  });
});

describe('googleDriveProvider.upload', () => {
  it('posts the PDF as multipart/related into the folder', async () => {
    const { googleDriveProvider } = await import('./google-drive.js');
    const { fetcher, calls } = stubFetch([
      TOKEN_OK,
      { match: /upload\/drive\/v3\/files/, reply: () => json({ id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1' }) },
    ]);

    const result = await googleDriveProvider.upload({
      refreshToken: 'rt',
      folderId: 'folder-1',
      file: { filename: 'afisz-2026-09-09-weekly.pdf', contentType: 'application/pdf', body: Buffer.from('%PDF-1.3 fake') },
      fetcher,
    });

    expect(result).toEqual({ fileId: 'file-1', webUrl: 'https://drive.google.com/file/d/file-1' });

    const upload = calls.find((c) => c.url.includes('/upload/'))!;
    const contentType = (upload.init!.headers as Record<string, string>)['content-type'];
    expect(contentType).toMatch(/^multipart\/related; boundary=/);

    const body = Buffer.from(upload.init!.body as Uint8Array).toString('binary');
    expect(body).toContain('"parents":["folder-1"]');
    expect(body).toContain('afisz-2026-09-09-weekly.pdf');
    expect(body).toContain('Content-Type: application/pdf');
    expect(body).toContain('%PDF-1.3 fake');
  });

  it('reports an upload the API rejected', async () => {
    const { googleDriveProvider } = await import('./google-drive.js');
    const { fetcher } = stubFetch([
      TOKEN_OK,
      { match: /upload\/drive\/v3\/files/, reply: () => json({ error: 'quota' }, 403) },
    ]);

    await expect(googleDriveProvider.upload({
      refreshToken: 'rt', folderId: 'f', fetcher,
      file: { filename: 'x.pdf', contentType: 'application/pdf', body: Buffer.from('x') },
    })).rejects.toThrow(/HTTP 403/);
  });
});

describe('googleDriveConfig', () => {
  it('is null — feature off — when the deployment has no Google credentials', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    vi.resetModules();
    const { googleDriveConfig } = await import('./google-drive.js');
    expect(googleDriveConfig()).toBeNull();
  });
});

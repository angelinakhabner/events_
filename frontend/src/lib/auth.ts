// Session token storage for magic-link login. The tRPC client reads this on
// every request (see makeTrpcClient), so login/logout take effect without
// recreating the client.

const KEY = 'goin-session';

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* private mode — session lasts for the tab via the in-memory fallback below */
    memoryToken = token;
  }
}

export function clearSessionToken(): void {
  memoryToken = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

let memoryToken: string | null = null;

export function isLoggedIn(): boolean {
  return !!(getSessionToken() ?? memoryToken);
}

import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { defaultVenueStore, type IVenueStore } from '../services/venue-store.js';
import { defaultFolderStore, type FolderStore } from '../services/folder-store.js';
import { defaultAuthStore, userForSession, type AuthStore, type AuthUser } from '../services/auth.js';
import { defaultUserVenueStore, type UserVenueStore } from '../services/user-venue-store.js';
import { defaultWantToGoStore, type WantToGoStore } from '../services/want-to-go-store.js';

export interface AppContext {
  venues: IVenueStore;
  folders: FolderStore;
  auth: AuthStore;
  userVenues: UserVenueStore;
  wantToGo: WantToGoStore;
  deviceId: string | null;
  /** Logged-in user resolved from the Authorization bearer, when valid. */
  user: AuthUser | null;
  /** The raw session token (for logout). */
  sessionToken: string | null;
}

export async function createContext(opts: FetchCreateContextFnOptions): Promise<AppContext> {
  const deviceId = opts.req.headers.get('x-device-id');
  const authHeader = opts.req.headers.get('authorization');
  const sessionToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const user = sessionToken ? await userForSession(defaultAuthStore, sessionToken) : null;
  return {
    venues: defaultVenueStore,
    folders: defaultFolderStore,
    auth: defaultAuthStore,
    userVenues: defaultUserVenueStore,
    wantToGo: defaultWantToGoStore,
    deviceId: deviceId && deviceId.length > 0 ? deviceId : null,
    user,
    sessionToken,
  };
}

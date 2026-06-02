import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { defaultVenueStore, VenueStore } from '../services/venue-store.js';
import { defaultFolderStore, type FolderStore } from '../services/folder-store.js';

export interface AppContext {
  venues: VenueStore;
  folders: FolderStore;
  deviceId: string | null;
}

export function createContext(opts: FetchCreateContextFnOptions): AppContext {
  const deviceId = opts.req.headers.get('x-device-id');
  return {
    venues: defaultVenueStore,
    folders: defaultFolderStore,
    deviceId: deviceId && deviceId.length > 0 ? deviceId : null,
  };
}

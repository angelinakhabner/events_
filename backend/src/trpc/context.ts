import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { defaultVenueStore, VenueStore } from '../services/venue-store.js';
import { defaultFolderStore, FolderStore } from '../services/folder-store.js';

export interface AppContext {
  venues: VenueStore;
  folders: FolderStore;
}

export function createContext(_opts: FetchCreateContextFnOptions): AppContext {
  return { venues: defaultVenueStore, folders: defaultFolderStore };
}

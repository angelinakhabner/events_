import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { defaultVenueStore, VenueStore } from '../services/venue-store.js';

export interface AppContext {
  venues: VenueStore;
}

export function createContext(_opts: FetchCreateContextFnOptions): AppContext {
  return { venues: defaultVenueStore };
}

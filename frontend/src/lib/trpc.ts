import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import { QueryClient } from '@tanstack/react-query';
import type { AppRouter } from '../../../backend/src/trpc/router';
import { getDeviceId } from './device-id';
import { getSessionToken } from './auth';

export const trpc = createTRPCReact<AppRouter>();

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: false },
    },
  });
}

export function makeTrpcClient() {
  const base = import.meta.env.VITE_API_URL ?? '';
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${base}/trpc`,
        // No cookies: the session is a bearer token in the header below, so
        // the default (`same-origin`, i.e. none cross-site) is what we want.
        // The invite cookie this used to carry is gone — the site is open.
        headers() {
          const token = getSessionToken();
          return {
            'x-device-id': getDeviceId(),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          };
        },
      }),
    ],
  });
}

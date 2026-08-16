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
        // The invite cookie (GOI-83) lives on the API's origin, which is not
        // this one — without `include` the browser withholds it and every
        // procedure comes back denied.
        fetch: (url, options) => fetch(url, { ...options, credentials: 'include' }),
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

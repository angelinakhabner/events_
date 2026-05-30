import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import { QueryClient } from '@tanstack/react-query';
import type { AppRouter } from '../../../backend/src/trpc/router';

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
    links: [httpBatchLink({ url: `${base}/trpc` })],
  });
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { trpc, makeQueryClient, makeTrpcClient } from './lib/trpc';
import { App } from './App';
import { DevGate } from './components/DevGate';
import { InviteGate } from './components/InviteGate';
import './index.css';

const queryClient = makeQueryClient();
const trpcClient = makeTrpcClient();
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DevGate>
      {/* Outside the tRPC provider on purpose (GOI-83): a visitor without an
          invite must not reach anything that can fire a query. */}
      <InviteGate>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter basename={basename || '/'}>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </trpc.Provider>
      </InviteGate>
    </DevGate>
  </React.StrictMode>,
);

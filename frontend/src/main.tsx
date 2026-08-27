import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { trpc, makeQueryClient, makeTrpcClient } from './lib/trpc';
import { App } from './App';
import { DevGate } from './components/DevGate';
import './index.css';

const queryClient = makeQueryClient();
const trpcClient = makeTrpcClient();
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* DevGate only bites on the dev preview build; production and local
        builds leave VITE_DEV_GATE_HASH unset, so the app is open to
        everyone and anyone can sign in from /my. */}
    <DevGate>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter basename={basename || '/'}>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </trpc.Provider>
    </DevGate>
  </React.StrictMode>,
);

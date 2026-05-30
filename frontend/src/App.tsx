import { useState } from 'react';
import { HomePage } from './pages/Home';
import { MyPage } from './pages/My';

type Route = 'home' | 'my';

export function App() {
  const [route, setRoute] = useState<Route>('home');
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto', padding: 16 }}>
      <header style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Goin</h1>
        <nav style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => setRoute('home')} aria-current={route === 'home'}>Home</button>
          <button onClick={() => setRoute('my')} aria-current={route === 'my'}>My folders</button>
        </nav>
      </header>
      {route === 'home' ? <HomePage /> : <MyPage />}
    </div>
  );
}

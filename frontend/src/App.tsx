import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/Home';
import { MyPage } from './pages/My';
import { AuthCallbackPage } from './pages/AuthCallback';
import { SharedListPage } from './pages/SharedList';
import { UnsubscribePage } from './pages/Unsubscribe';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/my" element={<MyPage />} />
        {/* GOI-47: a shared "want to go" list. Public — no session needed. */}
        <Route path="/list/:token" element={<SharedListPage />} />
        <Route path="/auth" element={<AuthCallbackPage />} />
        <Route path="/unsubscribe" element={<UnsubscribePage />} />
      </Route>
    </Routes>
  );
}

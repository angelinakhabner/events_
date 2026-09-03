import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/Home';
import { MyPage } from './pages/My';
import { AuthCallbackPage } from './pages/AuthCallback';
import { SharedListPage } from './pages/SharedList';
import { PolicyPage } from './pages/Policy';
import { TermsPage } from './pages/Terms';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/my" element={<MyPage />} />
        {/* GOI-47: a shared "want to go" list. Public — no session needed. */}
        <Route path="/list/:token" element={<SharedListPage />} />
        <Route path="/auth" element={<AuthCallbackPage />} />
        {/* GOI-95: the regulamin and the privacy notice. Public and outside
            the invite gate — art. 8(1)(1) of the ustawa o świadczeniu usług
            drogą elektroniczną requires the terms to be readable *before*
            using the service, which a login wall in front of them defeats. */}
        <Route path="/policy" element={<PolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Route>
    </Routes>
  );
}

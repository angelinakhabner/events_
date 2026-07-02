import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/Home';
import { MyPage } from './pages/My';
import { AuthCallbackPage } from './pages/AuthCallback';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/my" element={<MyPage />} />
        <Route path="/auth" element={<AuthCallbackPage />} />
      </Route>
    </Routes>
  );
}

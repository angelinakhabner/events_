import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/Home';
import { MyFoldersPage } from './pages/MyFolders';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/my" element={<MyFoldersPage />} />
      </Route>
    </Routes>
  );
}

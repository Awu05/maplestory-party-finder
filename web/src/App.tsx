import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CharactersPage } from './pages/CharactersPage';
import { MyCharactersPage } from './pages/MyCharactersPage';
import { CharacterFormPage } from './pages/CharacterFormPage';
import { AdminLayout } from './pages/admin/AdminLayout';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CharactersPage />} />
        <Route path="me/characters" element={<MyCharactersPage />} />
        <Route path="me/characters/new" element={<CharacterFormPage />} />
        <Route path="me/characters/:id/edit" element={<CharacterFormPage />} />
        <Route path="admin/*" element={<AdminLayout />} />
      </Route>
    </Routes>
  );
}

import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CharactersPage } from './pages/CharactersPage';
import { MyCharactersPage } from './pages/MyCharactersPage';
import { CharacterFormPage } from './pages/CharacterFormPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { GuildsAdmin } from './pages/admin/GuildsAdmin';
import { WorldsAdmin } from './pages/admin/WorldsAdmin';
import { BossesAdmin } from './pages/admin/BossesAdmin';
import { TiersAdmin } from './pages/admin/TiersAdmin';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CharactersPage />} />
        <Route path="me/characters" element={<MyCharactersPage />} />
        <Route path="me/characters/new" element={<CharacterFormPage />} />
        <Route path="me/characters/:id/edit" element={<CharacterFormPage />} />
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="guilds" replace />} />
          <Route path="guilds" element={<GuildsAdmin />} />
          <Route path="worlds" element={<WorldsAdmin />} />
          <Route path="bosses" element={<BossesAdmin />} />
          <Route path="tiers" element={<TiersAdmin />} />
        </Route>
      </Route>
    </Routes>
  );
}

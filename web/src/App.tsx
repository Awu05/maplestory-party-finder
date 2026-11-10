import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CharactersPage } from './pages/CharactersPage';
import { BoardPage } from './pages/BoardPage';
import { NewPostPage } from './pages/NewPostPage';
import { PostDetailPage } from './pages/PostDetailPage';
import { MyPartiesPage } from './pages/MyPartiesPage';
import { MyCharactersPage } from './pages/MyCharactersPage';
import { CharacterFormPage } from './pages/CharacterFormPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { GuildsAdmin } from './pages/admin/GuildsAdmin';
import { WorldsAdmin } from './pages/admin/WorldsAdmin';
import { BossesAdmin } from './pages/admin/BossesAdmin';
import { ClassesAdmin } from './pages/admin/ClassesAdmin';
import { TiersAdmin } from './pages/admin/TiersAdmin';
import { WebhooksAdmin } from './pages/admin/WebhooksAdmin';
import { UsersAdmin } from './pages/admin/UsersAdmin';
import { PostsAdmin } from './pages/admin/PostsAdmin';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<BoardPage />} />
        <Route path="characters" element={<CharactersPage />} />
        <Route path="posts/new" element={<NewPostPage />} />
        <Route path="posts/:id" element={<PostDetailPage />} />
        <Route path="posts/:id/edit" element={<NewPostPage />} />
        <Route path="me/parties" element={<MyPartiesPage />} />
        <Route path="me/characters" element={<MyCharactersPage />} />
        <Route path="me/characters/new" element={<CharacterFormPage />} />
        <Route path="me/characters/:id/edit" element={<CharacterFormPage />} />
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="guilds" replace />} />
          <Route path="guilds" element={<GuildsAdmin />} />
          <Route path="worlds" element={<WorldsAdmin />} />
          <Route path="bosses" element={<BossesAdmin />} />
          <Route path="classes" element={<ClassesAdmin />} />
          <Route path="tiers" element={<TiersAdmin />} />
          <Route path="webhooks" element={<WebhooksAdmin />} />
          <Route path="users" element={<UsersAdmin />} />
          <Route path="posts" element={<PostsAdmin />} />
        </Route>
      </Route>
    </Routes>
  );
}

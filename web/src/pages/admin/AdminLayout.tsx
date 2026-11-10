import { NavLink, Outlet } from 'react-router-dom';
import { useMe } from '../../api/hooks';
import './admin.css';

export function AdminLayout() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <p>Loading…</p>;
  if (!me?.isAdmin) return <p role="alert">Not authorized</p>;
  return (
    <section className="admin">
      <h1>Admin</h1>
      <nav className="admin__tabs" aria-label="Admin sections">
        <NavLink to="guilds">Guilds</NavLink>
        <NavLink to="worlds">Worlds</NavLink>
        <NavLink to="bosses">Bosses</NavLink>
        <NavLink to="tiers">Rarity tiers</NavLink>
        <NavLink to="webhooks">Webhooks</NavLink>
      </nav>
      <Outlet />
    </section>
  );
}

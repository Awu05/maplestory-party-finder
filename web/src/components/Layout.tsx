import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../api/hooks';
import { api } from '../api/client';

export function Layout() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  async function logout() {
    await api<void>('/api/auth/logout', { method: 'POST' });
    await qc.invalidateQueries({ queryKey: ['me'] });
    await qc.invalidateQueries({ queryKey: ['characters'] });
  }

  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand" onClick={close}>
          Party Finder
        </Link>
        <button
          type="button"
          className="menu-button"
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen((o) => !o)}
        >
          Menu
        </button>
        <nav id="main-nav" className={open ? 'nav open' : 'nav'} aria-label="Main">
          <NavLink to="/" end onClick={close}>
            Characters
          </NavLink>
          {me && (
            <NavLink to="/me/characters" onClick={close}>
              My characters
            </NavLink>
          )}
          {me?.isAdmin && (
            <NavLink to="/admin" onClick={close}>
              Admin
            </NavLink>
          )}
          <span className="spacer" />
          {me ? (
            <span className="user">
              {me.avatarUrl && <img className="avatar" src={me.avatarUrl} alt="" />}
              <span>{me.discordUsername}</span>
              <button type="button" onClick={logout}>
                Log out
              </button>
            </span>
          ) : (
            me === null && (
              <a className="button" href="/api/auth/discord">
                Log in with Discord
              </a>
            )
          )}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}

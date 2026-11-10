import { useState } from 'react';
import { Link, NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../api/hooks';
import { api } from '../api/client';
import { NotificationBell } from './NotificationBell';

export function Layout() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const loginFailed = searchParams.get('login') === 'failed';
  const loginBanned = searchParams.get('login') === 'banned';

  function dismissLoginFailed() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('login');
        return next;
      },
      { replace: true },
    );
  }

  async function logout() {
    try {
      await api<void>('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if the server call fails, drop the local session so the UI shows logged out.
    }
    qc.setQueryData(['me'], null);
    // Post data is viewer-specific (isPoster, myPending, invites): drop it, refetching what's on screen.
    qc.removeQueries({ queryKey: ['posts'], type: 'inactive' });
    qc.removeQueries({ queryKey: ['notifications'] });
    await Promise.all([
      qc.resetQueries({ queryKey: ['posts'], type: 'active' }),
      qc.invalidateQueries({ queryKey: ['characters'] }),
    ]);
  }

  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand" onClick={close}>
          Party<span>Finder</span>
        </Link>
        {/* DOM order is the phone focus order: Menu, then the nav it opens; CSS `order` places header-right beside Menu. */}
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
            Board
          </NavLink>
          <NavLink to="/characters" onClick={close}>
            Characters
          </NavLink>
          {me && (
            <NavLink to="/me/parties" onClick={close}>
              My parties
            </NavLink>
          )}
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
        </nav>
        <div className="header-right">
          {me && <NotificationBell />}
          {me ? (
            <>
              <span className="user">
                {me.avatarUrl && <img className="avatar" src={me.avatarUrl} alt="" />}
                <span className="user-name">{me.discordUsername}</span>
              </span>
              <button type="button" className="btn btn--secondary logout" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            me === null && (
              <a className="btn btn--primary" href="/api/auth/discord">
                Log in with Discord
              </a>
            )
          )}
        </div>
      </header>
      {loginFailed && (
        <div className="banner" role="alert">
          <span>Login with Discord failed — try again</span>
          <button type="button" aria-label="Dismiss" onClick={dismissLoginFailed}>
            ×
          </button>
        </div>
      )}
      {loginBanned && (
        <div className="banner" role="alert">
          <span>Your account has been banned.</span>
          <button type="button" aria-label="Dismiss" onClick={dismissLoginFailed}>
            ×
          </button>
        </div>
      )}
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}

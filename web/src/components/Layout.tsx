import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../api/hooks';
import { api } from '../api/client';
import { NotificationBell } from './NotificationBell';
import { ProfileDialog } from './ProfileDialog';
import { LoginButton } from './LoginDialog';

/** Banners for the `?link=` result the server redirects to after linking Discord. */
const LINK_BANNERS: Record<string, { role: 'status' | 'alert'; text: string } | undefined> = {
  done: { role: 'status', text: 'Discord account linked.' },
  already: { role: 'status', text: 'Your account is already linked to Discord.' },
  taken: { role: 'alert', text: "That Discord account already has its own Party Finder account, so it can't be linked. Log in with Discord to use it." },
  failed: { role: 'alert', text: 'Linking Discord failed — try again.' },
};

export function Layout() {
  // A failed /me (server error, network down) counts as logged out once it settles.
  const { data: me, isPending: mePending } = useMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // Focus the Profile button only after the popup has unmounted; while it is open the page behind it is inert.
  useEffect(() => {
    if (!profileOpen && returnFocus.current) {
      returnFocus.current = false;
      profileRef.current?.focus();
    }
  }, [profileOpen]);
  const closeProfile = () => {
    returnFocus.current = true;
    setProfileOpen(false);
  };
  const close = () => setOpen(false);
  // An unlinked account whose typed name was claimed by its owner may have neither name.
  const headerName = me ? me.displayName || me.discordUsername : '';
  const [searchParams, setSearchParams] = useSearchParams();
  const loginFailed = searchParams.get('login') === 'failed';
  const loginBanned = searchParams.get('login') === 'banned';
  const loginDeleted = searchParams.get('login') === 'deleted';
  const linkBanner = LINK_BANNERS[searchParams.get('link') ?? ''];

  function dismissParam(param: 'login' | 'link') {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(param);
        return next;
      },
      { replace: true },
    );
  }
  const dismissLoginFailed = () => dismissParam('login');

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
              <button
                ref={profileRef}
                type="button"
                className="user"
                aria-haspopup="dialog"
                aria-label={headerName ? `Profile: ${headerName}` : 'Profile'}
                onClick={() => {
                  close();
                  setProfileOpen(true);
                }}
              >
                {me.avatarUrl ? <img className="avatar" src={me.avatarUrl} alt="" /> : (
                  <span className="avatar avatar--placeholder" aria-hidden="true">{(headerName || '?').slice(0, 1).toUpperCase()}</span>
                )}
                {/* Visually hidden on phones by the @media rule in global.css. */}
                {headerName && <span className="user-name">{headerName}</span>}
              </button>
              {profileOpen && (
                <ProfileDialog
                  me={me}
                  onClose={closeProfile}
                  onLogout={() => {
                    // The Profile button goes away on log out: nothing to refocus.
                    setProfileOpen(false);
                    void logout();
                  }}
                />
              )}
            </>
          ) : (
            !mePending && (
              <LoginButton onOpen={close} />
            )
          )}
        </div>
      </header>
      {loginFailed && (
        <div className="banner" role="alert">
          <span>Login with Discord failed — try again</span>
          <button type="button" className="btn btn--secondary btn--compact" aria-label="Dismiss" onClick={dismissLoginFailed}>
            ×
          </button>
        </div>
      )}
      {loginBanned && (
        <div className="banner" role="alert">
          <span>Your account has been banned.</span>
          <button type="button" className="btn btn--secondary btn--compact" aria-label="Dismiss" onClick={dismissLoginFailed}>
            ×
          </button>
        </div>
      )}
      {loginDeleted && (
        <div className="banner" role="alert">
          <span>This account has been deleted.</span>
          <button type="button" className="btn btn--secondary btn--compact" aria-label="Dismiss" onClick={dismissLoginFailed}>
            ×
          </button>
        </div>
      )}
      {linkBanner && (
        <div className="banner" role={linkBanner.role}>
          <span>{linkBanner.text}</span>
          <button type="button" className="btn btn--secondary btn--compact" aria-label="Dismiss" onClick={() => dismissParam('link')}>
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

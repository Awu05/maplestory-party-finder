import { readFileSync } from 'node:fs';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { mockApi, renderWithProviders, testQueryClient } from './setup';

function findOrderViolations(css: string): string[] {
  const out: string[] = [];
  for (const [, rawSel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = rawSel.trim();
    if (/\.header-right\s*$/.test(sel)) {
      if (/row-reverse/.test(body)) out.push(sel);
    } else if (/\.(bell|user|user-name|avatar|logout)\b/.test(sel)) {
      if (/(^|[\s;{])order\s*:|row-reverse/.test(body)) out.push(sel);
    }
  }
  return out;
}

const user = { id: 'u1', discordUsername: 'maple_fan', avatarUrl: null, isAdmin: false };

describe('Layout', () => {
  it('logged out shows Log in with Discord linking /api/auth/discord', async () => {
    mockApi({ '/api/auth/me': null });
    renderWithProviders(<App />);
    const link = await screen.findByRole('link', { name: 'Log in with Discord' });
    expect(link).toHaveAttribute('href', '/api/auth/discord');
    expect(screen.queryByRole('link', { name: 'My characters' })).not.toBeInTheDocument();
  });

  it('logged in shows username and My characters, no Admin', async () => {
    mockApi({ '/api/auth/me': user });
    renderWithProviders(<App />);
    expect(await screen.findByText('maple_fan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My characters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('admin sees Admin link', async () => {
    mockApi({ '/api/auth/me': { ...user, isAdmin: true } });
    renderWithProviders(<App />);
    expect(await screen.findByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('?login=failed shows a dismissible login-failed banner', async () => {
    mockApi({ '/api/auth/me': null });
    renderWithProviders(<App />, { route: '/?login=failed' });
    expect(await screen.findByText('Login with Discord failed — try again')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Login with Discord failed/)).not.toBeInTheDocument();
  });

  it('no banner without ?login=failed', async () => {
    mockApi({ '/api/auth/me': null });
    renderWithProviders(<App />);
    await screen.findByRole('link', { name: 'Log in with Discord' });
    expect(screen.queryByText(/Login with Discord failed/)).not.toBeInTheDocument();
  });

  it('logout failure still clears the local session', async () => {
    const fetchMock = mockApi({
      '/api/auth/me': user,
      'POST /api/auth/logout': () => {
        throw new Error('network down');
      },
    });
    renderWithProviders(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('link', { name: 'Log in with Discord' })).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === '/api/auth/logout' && i?.method === 'POST')).toBe(true),
    );
  });

  it('logout drops cached viewer-specific post data', async () => {
    mockApi({ '/api/auth/me': user, 'POST /api/auth/logout': undefined });
    const client = testQueryClient();
    // Keep unobserved entries cached, as a real session's would be while navigating.
    client.setQueryDefaults(['posts'], { gcTime: Infinity });
    client.setQueryData(['posts', 'detail', 'p1'], { id: 'p1', isPoster: true });
    client.setQueryData(['posts', 'mine', 'requests'], { incomingInvites: [], outgoingRequests: [] });
    renderWithProviders(<App />, { client });
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await screen.findByRole('link', { name: 'Log in with Discord' });
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['posts', 'detail'] })).toHaveLength(0));
    expect(client.getQueryData(['posts', 'mine', 'requests'])).toBeUndefined();
  });

  it('nav has Board at / and Characters at /characters', async () => {
    mockApi({ '/api/auth/me': null });
    renderWithProviders(<App />);
    expect(await screen.findByRole('link', { name: 'Board' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Characters' })).toHaveAttribute('href', '/characters');
    expect(screen.queryByRole('link', { name: 'My parties' })).not.toBeInTheDocument();
  });

  it('bell, username and Log out share .header-right in that order', async () => {
    mockApi({ '/api/auth/me': user, '/api/notifications?limit=30': { items: [], unreadCount: 0 } });
    renderWithProviders(<App />);
    const name = await screen.findByText('maple_fan');
    const bell = await screen.findByRole('button', { name: /notifications/i });
    const logout = screen.getByRole('button', { name: 'Log out' });
    const group = bell.closest('.header-right');
    expect(group).not.toBeNull();
    expect(group).toContainElement(name);
    expect(group).toContainElement(logout);
    expect(bell.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('findOrderViolations flags visual reordering only', () => {
    expect(findOrderViolations('.bell { order: 1 }')).toHaveLength(1);
    expect(findOrderViolations('.user { order: 5 }')).toHaveLength(1);
    expect(findOrderViolations('.user-name { order: 2 }')).toHaveLength(1);
    expect(findOrderViolations('.header-right { flex-direction: row-reverse }')).toHaveLength(1);
    expect(findOrderViolations('.header-right { order: 1 }')).toHaveLength(0);
    expect(findOrderViolations('.bell { border: 1px solid red }')).toHaveLength(0);
  });

  it('header CSS does not reorder the right group visually', () => {
    for (const f of ['src/components/bell.css', 'src/styles/global.css']) {
      expect(findOrderViolations(readFileSync(f, 'utf8')), f).toEqual([]);
    }
  });

  it('brand renders Party and Finder', async () => {
    mockApi({ '/api/auth/me': null });
    renderWithProviders(<App />);
    const brand = await screen.findByRole('link', { name: 'PartyFinder' });
    expect(brand).toHaveClass('brand');
    expect(brand.firstChild?.textContent).toBe('Party');
    expect(brand.querySelector('span')?.textContent).toBe('Finder');
  });

  it('My parties shown when logged in', async () => {
    mockApi({ '/api/auth/me': user });
    renderWithProviders(<App />);
    expect(await screen.findByRole('link', { name: 'My parties' })).toHaveAttribute('href', '/me/parties');
  });
});

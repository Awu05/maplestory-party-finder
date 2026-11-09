import { fireEvent, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { mockApi, renderWithProviders } from './setup';

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
});

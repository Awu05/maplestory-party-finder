import { screen } from '@testing-library/react';
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
});

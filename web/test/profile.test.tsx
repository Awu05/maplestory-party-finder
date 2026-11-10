import { fireEvent, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { mockApi, renderWithProviders } from './setup';

it('opens Profile from the header, saves a display name, and updates the header', async () => {
  let me = { id: 'u1', discordUsername: 'maple_fan', displayName: null as string | null, avatarUrl: null, isAdmin: false };
  const fetch = mockApi({
    '/api/auth/me': () => me,
    'PATCH /api/auth/me': (init?: RequestInit) => {
      me = { ...me, displayName: JSON.parse(String(init?.body)).displayName };
      return me;
    },
    '/api/notifications': { items: [], unreadCount: 0 },
  });
  renderWithProviders(<App />, { route: '/me/profile' });
  const input = await screen.findByLabelText('Display name');
  expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/me/profile');
  expect(screen.getByText('Discord: @maple_fan')).toBeVisible();
  fireEvent.change(input, { target: { value: 'Maple Friend' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Profile saved.');
  expect(screen.getByRole('link', { name: /profile/i })).toHaveTextContent('Maple Friend');
  expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Maple Friend' }) }));
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('link', { name: /profile/i })).toHaveTextContent('maple_fan'));
});

it('asks logged-out visitors to log in', async () => {
  mockApi({ '/api/auth/me': null });
  renderWithProviders(<App />, { route: '/me/profile' });
  expect(await screen.findByText('Log in to edit your profile.')).toBeVisible();
});

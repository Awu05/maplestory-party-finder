import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App';
import { mockApi, renderWithProviders } from './setup';

const NOTIF = { '/api/notifications?limit=30': { items: [], unreadCount: 0 } };

it('opens the Profile popup from the header, saves a display name, and updates the header', async () => {
  let me = { id: 'u1', discordUsername: 'maple_fan', displayName: null as string | null, avatarUrl: null, isAdmin: false };
  const fetch = mockApi({
    ...NOTIF,
    '/api/auth/me': () => me,
    'PATCH /api/auth/me': (init?: RequestInit) => {
      me = { ...me, displayName: JSON.parse(String(init?.body)).displayName };
      return me;
    },
  });
  renderWithProviders(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Profile: maple_fan' }));
  const dialog = screen.getByRole('dialog', { name: 'Profile' });
  expect(within(dialog).getByText('Discord: @maple_fan')).toBeVisible();
  const input = within(dialog).getByLabelText('Display name');
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'Maple Friend' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: 'Profile: Maple Friend' })).toHaveTextContent('Maple Friend');
  expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Maple Friend' }) }));

  fireEvent.click(screen.getByRole('button', { name: 'Profile: Maple Friend' }));
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Profile: maple_fan' })).toBeInTheDocument());
  expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: null }) }));
});

it('Cancel and Escape close the popup without saving', async () => {
  const fetch = mockApi({ ...NOTIF, '/api/auth/me': { id: 'u1', discordUsername: 'maple_fan', displayName: null, avatarUrl: null, isAdmin: false } });
  renderWithProviders(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Profile: maple_fan' }));
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Profile: maple_fan' }));
  expect(screen.getByLabelText('Display name')).toHaveValue('');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(fetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
});

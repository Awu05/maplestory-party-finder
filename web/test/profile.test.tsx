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

it.each([
  ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
  ['Escape', () => fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))],
])('%s returns focus to the Profile button only after the popup unmounts', async (_n, closeIt) => {
  mockApi({ ...NOTIF, '/api/auth/me': { id: 'u1', discordUsername: 'maple_fan', displayName: null, avatarUrl: null, isAdmin: false } });
  renderWithProviders(<App />);
  const btn = await screen.findByRole('button', { name: 'Profile: maple_fan' });
  fireEvent.click(btn);
  await screen.findByRole('dialog');
  const calls: boolean[] = [];
  const orig = btn.focus.bind(btn);
  btn.focus = () => {
    calls.push(document.querySelector('dialog') !== null);
    orig();
  };
  closeIt();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls).toEqual([false]);
  expect(btn).toHaveFocus();
});

it('shows a typed Discord name as unverified and editable, with a Link Discord button, for accounts not linked to Discord', async () => {
  let me = { id: 'u1', discordUsername: 'typed_name', displayName: 'Typed', avatarUrl: null, isAdmin: false, discordLinked: false };
  const fetch = mockApi({
    ...NOTIF,
    '/api/auth/me': () => me,
    'PATCH /api/auth/me': (init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      me = { ...me, displayName: body.displayName, discordUsername: body.discordUsername ?? me.discordUsername };
      return me;
    },
  });
  renderWithProviders(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Profile: Typed' }));
  const dialog = screen.getByRole('dialog', { name: 'Profile' });
  expect(within(dialog).queryByText(/@typed_name/)).toBeNull();
  const link = within(dialog).getByRole('link', { name: 'Link Discord account' });
  expect(link).toHaveAttribute('href', '/api/auth/discord/link');
  expect(link).toHaveClass('btn', 'btn--secondary');
  expect(within(dialog).getByText(/verifies your Discord name and user ID/)).toBeVisible();
  const name = within(dialog).getByLabelText(/Discord username/);
  expect(name).toHaveValue('typed_name');
  expect(within(dialog).getByText('unverified')).toBeVisible();
  fireEvent.change(name, { target: { value: ' new_name ' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Typed', discordUsername: 'new_name' }) }));
});

it('shows and saves the typed Discord user ID for an unlinked account', async () => {
  const me = { id: 'u1', discordUsername: 'typed_name', discordUserId: '123456789012345678', displayName: 'Typed', avatarUrl: null, isAdmin: false, discordLinked: false };
  const fetch = mockApi({ ...NOTIF, '/api/auth/me': me, 'PATCH /api/auth/me': { ...me, discordUserId: '223456789012345678' } });
  renderWithProviders(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Profile: Typed' }));
  expect(screen.getByLabelText('Discord user ID')).toHaveValue(me.discordUserId);
  fireEvent.change(screen.getByLabelText('Discord user ID'), { target: { value: ' 223456789012345678 ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: 'Typed', discordUserId: '223456789012345678' }) }));
});

it('hides the typed user ID field for a linked account', async () => {
  mockApi({ ...NOTIF, '/api/auth/me': { id: 'u1', discordUsername: 'linked', displayName: 'Linked', avatarUrl: null, isAdmin: false, discordLinked: true } });
  renderWithProviders(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Profile: Linked' }));
  expect(screen.queryByLabelText('Discord user ID')).not.toBeInTheDocument();
});

it('shows a taken Discord username error and keeps the popup open', async () => {
  const fetch = mockApi({ ...NOTIF, '/api/auth/me': { id: 'u1', discordUsername: 'typed_name', displayName: 'Typed', avatarUrl: null, isAdmin: false, discordLinked: false } });
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, init) => (init as RequestInit | undefined)?.method === 'PATCH'
    ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'USERNAME_TAKEN', message: 'That Discord username is already in use.' } }), { status: 409 })) : fallback(url, init));
  renderWithProviders(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Profile: Typed' }));
  fireEvent.change(screen.getByLabelText(/Discord username/), { target: { value: 'someone_else' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  const dialog = screen.getByRole('dialog', { name: 'Profile' });
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('That Discord username is already in use.');
});

it('explains a Discord username claimed by its owner and never shows it blank', async () => {
  const fetch = mockApi({ ...NOTIF, '/api/auth/me': { id: 'u1', discordUsername: '', displayName: null, avatarUrl: null, isAdmin: false, discordLinked: false } });
  renderWithProviders(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Profile' }));
  const dialog = screen.getByRole('dialog', { name: 'Profile' });
  expect(within(dialog).getByText('Your Discord username was claimed by its owner. Enter a different one or link your Discord account.')).toBeVisible();
  expect(within(dialog).getByLabelText(/Discord username/)).toHaveValue('');
  // Saving with the name still empty only saves the display name.
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ displayName: null }) })));
});

it('keeps the read-only Discord handle for linked accounts, with no link button or name field', async () => {
  mockApi({ ...NOTIF, '/api/auth/me': { id: 'u1', discordUsername: 'maple_fan', displayName: null, avatarUrl: null, isAdmin: false, discordLinked: true } });
  renderWithProviders(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Profile: maple_fan' }));
  const dialog = screen.getByRole('dialog', { name: 'Profile' });
  expect(within(dialog).getByText('Discord: @maple_fan')).toBeVisible();
  expect(within(dialog).queryByRole('link', { name: 'Link Discord account' })).toBeNull();
  expect(within(dialog).queryByLabelText(/Discord username/)).toBeNull();
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { App } from '../src/App';
import { mockApi, renderWithProviders } from './setup';

vi.mock('@simplewebauthn/browser', () => ({ browserSupportsWebAuthn: vi.fn(() => true), startAuthentication: vi.fn(), startRegistration: vi.fn() }));
const user = { id: 'local1', discordUsername: 'maple_user', displayName: 'Maple Player', avatarUrl: null, isAdmin: false, discordLinked: false };
const base = { '/api/auth/config': { passwordAuth: true }, '/api/auth/me': null, '/api/characters?mine=1': [], '/api/posts': [], '/api/worlds': [], '/api/bosses': [], '/api/rarity-tiers': [] };
const registration = { id: 'credential', rawId: 'credential', type: 'public-key' as const, clientExtensionResults: {}, response: { clientDataJSON: 'data', attestationObject: 'proof' } };
const assertion = { id: 'credential', rawId: 'credential', type: 'public-key' as const, clientExtensionResults: {}, response: { clientDataJSON: 'data', authenticatorData: 'auth', signature: 'signature', userHandle: 'handle' } };
beforeEach(() => { vi.stubGlobal('isSecureContext', true); vi.mocked(browserSupportsWebAuthn).mockReturnValue(true); });
afterEach(() => vi.clearAllMocks());

async function open() {
  fireEvent.click(await screen.findByRole('button', { name: 'Log in' }));
  return screen.findByRole('dialog', { name: 'Log in' });
}

it('opens the account form with contact fields and restores focus after closing', async () => {
  mockApi(base);
  renderWithProviders(<App />);
  const trigger = await screen.findByRole('button', { name: 'Log in' });
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
  const create = await screen.findByRole('dialog', { name: 'Create account' });
  expect(within(create).getAllByRole('textbox')).toHaveLength(3);
  expect(within(create).getByLabelText('Discord username')).toHaveFocus();
  expect(within(create).getByLabelText('Display name')).toBeInTheDocument();
  expect(within(create).getByLabelText('Discord user ID')).toBeRequired();
  expect(within(create).getByLabelText('Discord user ID')).toHaveAttribute('inputmode', 'numeric');
  expect(within(create).getByText(/Developer Mode, then right-click your name and choose Copy User ID/)).toBeVisible();
  expect(within(create).getByText(/there is no email or password recovery/)).toBeInTheDocument();
  fireEvent.click(within(create).getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('dialog', { name: 'Log in' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('creates a passkey account and navigates to My characters', async () => {
  const options = { challenge: 'register-challenge' };
  vi.mocked(startRegistration).mockResolvedValue(registration);
  const fetch = mockApi({ ...base, 'POST /api/auth/passkeys/register/options': options, 'POST /api/auth/passkeys/register/verify': user });
  renderWithProviders(<App />);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
  fireEvent.change(screen.getByLabelText('Discord username'), { target: { value: ' maple_user ' } });
  fireEvent.change(screen.getByLabelText('Discord user ID'), { target: { value: ' 123456789012345678 ' } });
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: ' Maple Player ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('heading', { name: 'My characters' })).toBeInTheDocument();
  expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: options });
  const call = fetch.mock.calls.find(([url]) => url === '/api/auth/passkeys/register/options')!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ discordUserId: '123456789012345678', discordUsername: 'maple_user', displayName: 'Maple Player' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Profile: Maple Player' }));
  expect(screen.getByText(/Add your Discord user ID/)).toBeInTheDocument();
});

it('signs in to an existing account using the saved passkey', async () => {
  const options = { challenge: 'login-challenge' };
  vi.mocked(startAuthentication).mockResolvedValue(assertion);
  mockApi({ ...base, 'POST /api/auth/passkeys/login/options': options, 'POST /api/auth/passkeys/login/verify': user });
  renderWithProviders(<App />);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in with a passkey' }));
  expect(await screen.findByRole('heading', { name: 'My characters' })).toBeInTheDocument();
  expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
});

it('handles a cancelled passkey prompt without creating an account', async () => {
  vi.mocked(startRegistration).mockRejectedValue(new DOMException('Cancelled', 'NotAllowedError'));
  const fetch = mockApi({ ...base, 'POST /api/auth/passkeys/register/options': { challenge: 'register' } });
  renderWithProviders(<App />);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
  fireEvent.change(screen.getByLabelText('Discord username'), { target: { value: 'maple_user' } });
  fireEvent.change(screen.getByLabelText('Discord user ID'), { target: { value: ' 123456789012345678 ' } });
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Maple Player' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('cancelled or timed out');
  expect(fetch.mock.calls.some(([url]) => url === '/api/auth/passkeys/register/verify')).toBe(false);
  expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
});

it('offers email and password when passkeys are not supported', async () => {
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
  mockApi(base);
  renderWithProviders(<App />);
  const dialog = await open();
  expect(within(dialog).getByRole('button', { name: 'Sign in with a passkey' })).toBeDisabled();
  expect(within(dialog).getByRole('link', { name: 'Log in with Discord' })).toHaveAttribute('href', '/api/auth/discord');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
  expect(screen.getByRole('radio', { name: 'Email and password' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Passkey' })).toBeDisabled();
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
});

it('creates an email/password account without invoking the passkey prompt', async () => {
  const fetch = mockApi({ ...base, 'POST /api/auth/password/register': user });
  renderWithProviders(<App />);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Email and password' }));
  fireEvent.change(screen.getByLabelText('Discord username'), { target: { value: 'maple_user' } });
  fireEvent.change(screen.getByLabelText('Discord user ID'), { target: { value: ' 123456789012345678 ' } });
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Maple Player' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maple@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long maple password' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match');
  expect(fetch.mock.calls.some(([url]) => url === '/api/auth/password/register')).toBe(false);
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a long maple password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('heading', { name: 'My characters' })).toBeInTheDocument();
  const call = fetch.mock.calls.find(([url]) => url === '/api/auth/password/register')!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ discordUserId: '123456789012345678', discordUsername: 'maple_user', displayName: 'Maple Player', email: 'maple@example.com', password: 'a long maple password' });
  expect(startRegistration).not.toHaveBeenCalled();
});

it('signs back in with email and password', async () => {
  mockApi({ ...base, 'POST /api/auth/password/login': user });
  renderWithProviders(<App />);
  const dialog = await open();
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Log in with email' }));
  const emailDialog = await screen.findByRole('dialog', { name: 'Log in with email' });
  expect(screen.getByLabelText('Email')).toHaveFocus();
  expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maple@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long maple password' } });
  fireEvent.click(within(emailDialog).getByRole('button', { name: 'Log in' }));
  expect(await screen.findByRole('heading', { name: 'My characters' })).toBeInTheDocument();
  expect(startAuthentication).not.toHaveBeenCalled();
});

it('keeps failed email sign-in in the dialog and clears the password when going back', async () => {
  const fetch = mockApi(base);
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, init) => String(url).endsWith('/password/login')
    ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } }), { status: 401 })) : fallback(url, init));
  renderWithProviders(<App />);
  const dialog = await open();
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Log in with email' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maple@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong password' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Log in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Log in with email' }));
  expect(screen.getByLabelText('Password')).toHaveValue('');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('shows a server verification error without signing in', async () => {
  vi.mocked(startAuthentication).mockResolvedValue(assertion);
  const fetch = mockApi({ ...base, 'POST /api/auth/passkeys/login/options': { challenge: 'login' } });
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, init) => String(url).endsWith('/login/verify')
    ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'PASSKEY_INVALID', message: 'Passkey verification failed.' } }), { status: 400 })) : fallback(url, init));
  renderWithProviders(<App />);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in with a passkey' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Passkey verification failed.'));
  expect(screen.getByRole('dialog', { name: 'Log in' })).toBeInTheDocument();
});

it('with password login off, the popup offers only Discord and passkeys', async () => {
  mockApi({ ...base, '/api/auth/config': { passwordAuth: false } });
  renderWithProviders(<App />);
  const dialog = await open();
  expect(within(dialog).getByRole('link', { name: 'Log in with Discord' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Sign in with a passkey' })).toBeEnabled();
  expect(within(dialog).queryByRole('button', { name: 'Log in with email' })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
  const create = await screen.findByRole('dialog', { name: 'Create account' });
  expect(within(create).queryByRole('radio')).toBeNull();
  expect(within(create).queryByLabelText('Email')).toBeNull();
  expect(within(create).queryByLabelText('Password')).toBeNull();
  expect(within(create).getByText(/save a passkey/)).toBeInTheDocument();
});

it('password login stays hidden when the setting cannot be loaded', async () => {
  const { '/api/auth/config': _omit, ...withoutConfig } = base;
  mockApi(withoutConfig);
  renderWithProviders(<App />);
  const dialog = await open();
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Sign in with a passkey' })).toBeInTheDocument());
  expect(within(dialog).queryByRole('button', { name: 'Log in with email' })).toBeNull();
});

it('with password login off and no passkey support, account creation points to Discord', async () => {
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
  mockApi({ ...base, '/api/auth/config': { passwordAuth: false } });
  renderWithProviders(<App />);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
  const create = await screen.findByRole('dialog', { name: 'Create account' });
  expect(within(create).getByRole('button', { name: 'Create account' })).toBeDisabled();
  expect(within(create).getByText(/You can log in with Discord instead\./)).toBeInTheDocument();
  expect(within(create).queryByText(/email and password/i)).toBeNull();
});

it('shows the server message when the typed Discord username is already in use', async () => {
  const fetch = mockApi(base);
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, init) => String(url).endsWith('/passkeys/register/options')
    ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'USERNAME_TAKEN', message: 'That Discord username is already in use.' } }), { status: 409 })) : fallback(url, init));
  renderWithProviders(<App />);
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
  fireEvent.change(screen.getByLabelText('Discord username'), { target: { value: 'maple_user' } });
  fireEvent.change(screen.getByLabelText('Discord user ID'), { target: { value: ' 123456789012345678 ' } });
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Maple Player' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('That Discord username is already in use.');
  expect(startRegistration).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Create account' })).toBeInTheDocument();
});

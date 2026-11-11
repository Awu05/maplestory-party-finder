import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from '../src/App';
import { mockApi, renderWithProviders } from './setup';

const base = { '/api/auth/me': null, '/api/posts': [], '/api/worlds': [], '/api/bosses': [], '/api/rarity-tiers': [] };
const token = 'x'.repeat(43);

it('requests a reset from email login and shows a generic confirmation', async () => {
  const fetch = mockApi({ ...base, 'POST /api/auth/password/forgot': { message: 'sent' } });
  renderWithProviders(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Log in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Log in with email' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maple@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
  expect(screen.getByRole('dialog', { name: 'Reset password' })).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toHaveValue('maple@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByRole('status')).toHaveTextContent('If an account uses that email');
  expect(screen.queryByRole('button', { name: 'Send reset link' })).not.toBeInTheDocument();
  const call = fetch.mock.calls.find(([url]) => url === '/api/auth/password/forgot')!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ email: 'maple@example.com' });
  fireEvent.click(screen.getByRole('button', { name: 'Back to email login' }));
  expect(screen.getByRole('dialog', { name: 'Log in with email' })).toBeInTheDocument();
});

it('sets a new password without automatically logging in', async () => {
  const fetch = mockApi({ ...base, 'POST /api/auth/password/reset': undefined });
  renderWithProviders(<App />, { route: `/reset-password#token=${token}` });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a new maple password' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a different password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match');
  expect(fetch.mock.calls.some(([url]) => url === '/api/auth/password/reset')).toBe(false);
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a new maple password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(await screen.findByRole('status')).toHaveTextContent('signed out on all devices');
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  const call = fetch.mock.calls.find(([url]) => url === '/api/auth/password/reset')!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ token, password: 'a new maple password' });
  expect(fetch.mock.calls.some(([url]) => String(url).includes(token))).toBe(false);
  expect(screen.queryByRole('button', { name: /^Profile:/ })).not.toBeInTheDocument();
});

it('rejects a malformed link without submitting a request', async () => {
  const fetch = mockApi(base);
  renderWithProviders(<App />, { route: '/reset-password#token=bad' });
  expect(await screen.findByRole('alert')).toHaveTextContent('reset link is invalid');
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => url === '/api/auth/password/reset')).toBe(false);
});

it('shows an expired-link error and lets the user request another link', async () => {
  const fetch = mockApi(base);
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, init) => String(url).endsWith('/password/reset')
    ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'RESET_INVALID', message: 'This reset link is invalid or has expired. Request a new one.' } }), { status: 400 })) : fallback(url, init));
  renderWithProviders(<App />, { route: `/reset-password#token=${token}` });
  for (const label of ['New password', 'Confirm password']) fireEvent.change(screen.getByLabelText(label), { target: { value: 'a new maple password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
  fireEvent.click(within(screen.getByRole('region', { hidden: true })).getByRole('button', { name: 'Log in' }));
  expect(await screen.findByRole('dialog', { name: 'Log in' })).toBeInTheDocument();
});

it('shows an email-configuration error instead of claiming a link was sent', async () => {
  const fetch = mockApi(base);
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, init) => String(url).endsWith('/password/forgot')
    ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'RESET_UNAVAILABLE', message: 'Password reset email is not available yet. Please contact the administrator.' } }), { status: 503 })) : fallback(url, init));
  renderWithProviders(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Log in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Log in with email' }));
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maple@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not available yet'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

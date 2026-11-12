import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { PostDetailDTO } from '@pf/shared';
import { DiscordDestinationSettings } from '../src/components/post/DiscordDestinationSettings';
import { mockApi, renderWithProviders } from './setup';

const post = { id: 'p1', type: 'recruiting', world: { id: 5, name: 'Kronos' }, notificationGuild: null, partyForumGuild: null, partyChatRequested: false } as PostDetailDTO;
const choices = [
  { id: 'notify', name: 'Notification server', worldIds: [5], notifications: true, partyForum: false },
  { id: 'chat', name: 'Chat server', worldIds: [5], notifications: false, partyForum: true },
  { id: 'wrong', name: 'Other world', worldIds: [6], notifications: true, partyForum: true },
];

it('saves independent Discord destinations directly on the post page without sending an announcement', async () => {
  const fetch = mockApi({ '/api/discord-destinations': choices, 'PATCH /api/posts/p1': post });
  renderWithProviders(<DiscordDestinationSettings post={post} />);
  const notifications = await screen.findByLabelText('Notification guild');
  await waitFor(() => expect(notifications).toBeEnabled());
  expect(within(notifications).queryByRole('option', { name: 'Chat server' })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Other world' })).not.toBeInTheDocument();
  fireEvent.change(notifications, { target: { value: 'notify' } });
  fireEvent.change(screen.getByLabelText('Party chat guild'), { target: { value: 'chat' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Discord destinations' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url, init]) => url === '/api/posts/p1' && init?.method === 'PATCH')).toBe(true));
  const call = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ notificationGuildId: 'notify', partyForumGuildId: 'chat' });
  expect(fetch.mock.calls.some(([url]) => String(url).includes('discord-announcement'))).toBe(false);
});

it('locks the requested party forum while allowing notifications to be disabled', async () => {
  const fetch = mockApi({ '/api/discord-destinations': choices, 'PATCH /api/posts/p1': post });
  renderWithProviders(<DiscordDestinationSettings post={{ ...post, notificationGuild: { id: 'notify', name: 'Notification server' }, partyForumGuild: { id: 'chat', name: 'Chat server' }, partyChatRequested: true }} />);
  await waitFor(() => expect(screen.getByLabelText('Notification guild')).toBeEnabled());
  expect(screen.getByLabelText('Party chat guild')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Notification guild'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Discord destinations' }));
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
  const call = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({ notificationGuildId: null });
});

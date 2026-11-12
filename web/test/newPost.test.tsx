import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostDetailDTO } from '@pf/shared';
import { App } from '../src/App';
import { localInputToUtcIso } from '../src/components/post/time';
vi.mock('../src/lib/timeZone', () => ({ browserTimeZone: () => 'America/New_York' }));

import { mockApi, renderWithProviders } from './setup';

const user = { id: 'u1', discordUsername: 'maple_fan', avatarUrl: null, isAdmin: false };

const lily: CharacterDTO = {
  id: 'c1',
  ign: 'Lily',
  world: { id: 5, name: 'Kronos' },
  jobName: 'Bishop', archetype: 'magician',
  level: 280,
  imageUrl: 'http://img/lily.png',
  combatPower: 1_500_000_000,
  cpUpdatedAt: '2026-11-01T00:00:00Z',
  guild: { id: 'g1', name: 'Maple Guild', iconUrl: null }, manual: false,
  screenshotUrl: null,
  owner: { discordUsername: 'lily#1', displayName: null, discordLinked: true },
  isOwner: true,
  syncStatus: 'ok',
  lastSyncedAt: '2026-11-01T00:00:00Z',
};

const bosses = [
  { id: 1, name: 'Lucid', imageUrl: null, difficulties: [{ id: 7, difficulty: 'Hard', partyCap: 6 }] },
  { id: 2, name: 'Limbo', imageUrl: null, difficulties: [{ id: 9, difficulty: 'Normal', partyCap: 3 }] },
];

const poster: PartyMemberDTO = {
  id: 'm1',
  role: 'poster',
  characterId: 'c1',
  cpAtJoin: 1_500_000_000,
  joinedAt: '2026-11-09T00:00:00Z',
  character: lily,
  snapshot: { ign: 'Lily', jobName: 'Bishop', level: 280, imageUrl: 'http://img/lily.png', worldName: 'Kronos', guildName: 'Maple Guild' },
  freeTimes: [], freeTimesZone: null, isMine: true,
};

function makePost(over: Partial<PostDetailDTO> = {}): PostDetailDTO {
  return {
    id: 'p1',
    type: 'recruiting',
    world: { id: 5, name: 'Kronos' },
    guild: { id: 'g1', name: 'Maple Guild' },
    poster,
    bosses: [{ bossDifficultyId: 7, bossName: 'Lucid', difficulty: 'Hard' }],
    scheduledAt: localInputToUtcIso('2026-11-10T20:00'),
    freeTimes: [],
    weeklyTimeZone: null, freeTimesZone: null,
    expiresAt: '2026-11-17T00:00:00Z',
    createdAt: '2026-11-09T00:00:00Z',
    partySize: 4,
    memberCount: 1,
    minCp: 300_000_000,
    note: 'Chill run',
    status: 'open',
    deleted: false,
    isPoster: true,
    members: [poster],
    isMember: true,
    incomingRequests: [],
    sentInvites: [],
    myPending: [],
    receivedInvites: [],
    sentInvitesToThis: [],
    canRenew: false,
    ...over,
  };
}

const base = {
  '/api/discord-destinations': [],
  '/api/auth/me': user,
  '/api/bosses': bosses,
  '/api/characters?mine=1': [lily],
};

const writes = (m: ReturnType<typeof mockApi>) =>
  m.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PATCH');
const body = (call: Parameters<typeof fetch>) => JSON.parse(String(call[1]?.body));

const pickBoss = async (name: string) => {
  const checkbox = await screen.findByLabelText(name);
  const area = checkbox.closest('details');
  if (area && !area.open) fireEvent.click(area.querySelector('summary')!);
  fireEvent.click(checkbox);
};
const pickCharacter = async () => fireEvent.change(await screen.findByLabelText('Character'), { target: { value: 'c1' } });
const pickSlot = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 9, 12, 0));
});
afterEach(() => vi.useRealTimers());

describe('NewPostPage (create)', () => {
  it('lets a guildless character select different notification and party chat guilds', async () => {
    const destinations = [
      { id: 'notify', name: 'Notification guild', worldIds: [5], notifications: true, partyForum: false },
      { id: 'chat', name: 'Chat guild', worldIds: [5], notifications: false, partyForum: true },
      { id: 'wrong', name: 'Other world', worldIds: [6], notifications: true, partyForum: true },
    ];
    const fetch = mockApi({ ...base, '/api/discord-destinations': destinations, '/api/characters?mine=1': [{ ...lily, guild: null }], '/api/posts/p1': makePost(), 'POST /api/posts': makePost() });
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickCharacter();
    await pickBoss('Hard Lucid');
    expect(screen.getByLabelText('Notification guild')).toHaveValue('');
    expect(screen.getByLabelText('Party chat guild')).toHaveValue('');
    expect(screen.queryByRole('option', { name: 'Other world' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Notification guild'), { target: { value: 'notify' } });
    fireEvent.change(screen.getByLabelText('Party chat guild'), { target: { value: 'chat' } });
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(fetch)[0])).toMatchObject({ notificationGuildId: 'notify', partyForumGuildId: 'chat' });
  });

  it('clears incompatible Discord selections when the character changes worlds', async () => {
    mockApi({ ...base, '/api/discord-destinations': [{ id: 'g1', name: 'Maple Guild', worldIds: [5], notifications: true, partyForum: true }], '/api/characters?mine=1': [lily, { ...lily, id: 'c2', guild: null, world: { id: 6, name: 'Hyperion' } }] });
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickCharacter();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Maple Guild' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Notification guild'), { target: { value: 'g1' } });
    fireEvent.change(screen.getByLabelText('Party chat guild'), { target: { value: 'g1' } });
    expect(screen.getByLabelText('Party chat guild')).toHaveValue('g1');
    fireEvent.change(screen.getByLabelText('Character'), { target: { value: 'c2' } });
    expect(screen.getByLabelText('Notification guild')).toHaveValue('');
    expect(screen.getByLabelText('Party chat guild')).toHaveValue('');
  });
  it.each([false, true])('submits a carrying post and shows its finalization controls (guildless=%s)', async (guildless) => {
    const carrying = makePost({ type: 'carrying', scheduledAt: null, ...(guildless ? { guild: null } : {}) });
    const fetch = mockApi({ ...base, '/api/characters?mine=1': [{ ...lily, ...(guildless ? { guild: null } : {}) }], '/api/posts/p1': carrying, 'POST /api/posts': carrying });
    renderWithProviders(<App />, { route: '/posts/new' });
    fireEvent.click(await screen.findByRole('button', { name: 'Carrying' }));
    await pickCharacter();
    await pickBoss('Hard Lucid');
    fireEvent.change(screen.getByLabelText('Party size'), { target: { value: '4' } });
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(fetch)[0])).toMatchObject({ type: 'carrying', partySize: 4, bossDifficultyIds: [7] });
    expect(screen.getByRole('button', { name: 'Finalize time' })).toBeInTheDocument();
    expect(screen.getByText('Carrying')).toBeInTheDocument();
  });
  it('explains when new posts expire and how renewal works', async () => {
    mockApi(base);
    renderWithProviders(<App />, { route: '/posts/new' });
    expect(await screen.findByText(/Posts without a finalized time expire 7 days after creation/)).toHaveTextContent('You can renew your post for 7 days from the time you renew it.');
  });
  it('recruiting submit', async () => {
    const m = mockApi({ ...base, '/api/posts/p1': makePost(), 'POST /api/posts': makePost() });
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickCharacter();
    await pickBoss('Hard Lucid');
    fireEvent.change(screen.getByLabelText('Party size'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Min CP'), { target: { value: '300,000,000' } });
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(writes(m)).toHaveLength(1);
    expect(body(writes(m)[0])).toEqual({
      type: 'recruiting',
      characterId: 'c1',
      bossDifficultyIds: [7],
      freeTimes: [],
      freeTimesZone: null,
      partySize: 4,
      minCp: 300000000,
      note: '',
      notificationGuildId: null,
      partyForumGuildId: null,
    });
  });

  it('LFP hides party size and min CP and omits them from the body', async () => {
    const m = mockApi({ ...base, '/api/posts/p1': makePost(), 'POST /api/posts': makePost({ type: 'lfp' }) });
    renderWithProviders(<App />, { route: '/posts/new' });
    fireEvent.click(await screen.findByRole('button', { name: 'Looking for party' }));
    expect(screen.queryByLabelText('Party size')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Min CP')).not.toBeInTheDocument();
    await pickCharacter();
    await pickBoss('Hard Lucid');
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toEqual({
      type: 'lfp',
      characterId: 'c1',
      bossDifficultyIds: [7],
      freeTimes: [],
      freeTimesZone: null,
      note: '',
      notificationGuildId: null,
      partyForumGuildId: null,
    });
  });

  it('has no date input or Flexible checkbox, only the free-time grid', async () => {
    mockApi(base);
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickCharacter();
    expect(screen.queryByLabelText('When')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Flexible')).not.toBeInTheDocument();
    expect(screen.getByText("When you're free")).toBeInTheDocument();
    expect(screen.getByText("Leave empty if you're flexible")).toBeInTheDocument();
  });

  it('the grid is described by the "Leave empty" hint', async () => {
    mockApi(base);
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickCharacter();
    expect(screen.getByRole('grid', { name: "When you're free" })).toHaveAccessibleDescription("Leave empty if you're flexible");
  });

  it('sends the selected free times with the browser zone', async () => {
    const m = mockApi({ ...base, '/api/posts/p1': makePost(), 'POST /api/posts': makePost() });
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickCharacter();
    await pickBoss('Hard Lucid');
    pickSlot('Tue 8p');
    pickSlot('Sat 2p');
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toMatchObject({ freeTimes: [136, 316], freeTimesZone: 'America/New_York' });
  });

  it('an empty grid sends no free times and a null zone', async () => {
    const m = mockApi({ ...base, '/api/posts/p1': makePost(), 'POST /api/posts': makePost() });
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickCharacter();
    await pickBoss('Hard Lucid');
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toMatchObject({ freeTimes: [], freeTimesZone: null });
  });

  it('selecting Normal Limbo (cap 3) limits party size options to 2..3 and clamps 4 to 3', async () => {
    mockApi(base);
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickBoss('Hard Lucid');
    const size = screen.getByLabelText('Party size') as HTMLSelectElement;
    expect(size.value).toBe('4');
    await pickBoss('Normal Limbo');
    expect(Array.from(size.options).map((o) => o.value)).toEqual(['2', '3']);
    expect(size.value).toBe('3');
  });

  it('no bosses gives an error and no POST', async () => {
    const m = mockApi(base);
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickCharacter();
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick at least one boss.');
    expect(writes(m)).toHaveLength(0);
  });

  it('user with no characters sees Add a character first', async () => {
    mockApi({ ...base, '/api/characters?mine=1': [] });
    renderWithProviders(<App />, { route: '/posts/new' });
    const link = await screen.findByRole('link', { name: 'Add a character first' });
    expect(link).toHaveAttribute('href', '/me/characters/new');
  });

  it('logged-out user sees the login prompt', async () => {
    mockApi({ ...base, '/api/auth/me': null });
    renderWithProviders(<App />, { route: '/posts/new' });
    expect(await screen.findByText('Log in to post.')).toBeInTheDocument();
  });
});

describe('NewPostPage (edit)', () => {
  it('clears Discord destinations on world changes even when the guild serves both worlds', async () => {
    const guild = { id: 'shared', name: 'Shared guild' };
    const post = makePost({ notificationGuild: guild, partyForumGuild: guild });
    const fetch = mockApi({
      ...base,
      '/api/posts/p1': post,
      'PATCH /api/posts/p1': post,
      '/api/characters?mine=1': [lily, { ...lily, id: 'c2', world: { id: 6, name: 'Hyperion' } }],
      '/api/discord-destinations': [{ ...guild, worldIds: [5, 6], notifications: true, partyForum: true }],
    });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Notification guild')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Character'), { target: { value: 'c2' } });
    expect(screen.getByLabelText('Notification guild')).toHaveValue('');
    expect(screen.getByLabelText('Party chat guild')).toHaveValue('');
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(fetch)[0])).toEqual({ characterId: 'c2', notificationGuildId: null, partyForumGuildId: null });
  });
  it('does not send a party chat guild when the post becomes LFP', async () => {
    const post = makePost({ partyForumGuild: { id: 'chat', name: 'Chat guild' } });
    const fetch = mockApi({
      ...base,
      '/api/posts/p1': post,
      'PATCH /api/posts/p1': post,
      '/api/discord-destinations': [
        { id: 'chat', name: 'Chat guild', worldIds: [5], notifications: false, partyForum: true },
        { id: 'chat2', name: 'Other chat', worldIds: [5], notifications: false, partyForum: true },
      ],
    });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Party chat guild')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Party chat guild'), { target: { value: 'chat2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Looking for party' }));
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(fetch)[0])).not.toHaveProperty('partyForumGuildId');
  });
  it('prefills from the post and PATCHes only changed fields (note + partySize)', async () => {
    const m = mockApi({ ...base, '/api/posts/p1': makePost(), 'PATCH /api/posts/p1': makePost() });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('Chill run'));
    expect(screen.getByLabelText('Hard Lucid')).toBeChecked();
    expect(screen.getByLabelText('Min CP')).toHaveValue('300,000,000');
    expect(screen.getByLabelText('Party size')).toHaveValue('4');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'New note' } });
    fireEvent.change(screen.getByLabelText('Party size'), { target: { value: '5' } });
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toEqual({ partySize: 5, note: 'New note' });
  });

  it('shows stored free times selected and PATCHes without them when only the note changes', async () => {
    const post = makePost({ freeTimes: [136], freeTimesZone: 'America/New_York' });
    const m = mockApi({ ...base, '/api/posts/p1': post, 'PATCH /api/posts/p1': post });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('Chill run'));
    expect(screen.getByRole('button', { name: 'Tue 8p' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'New' } });
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toEqual({ note: 'New' });
  });

  it('converts a post stored in another zone and re-stores changes in the browser zone', async () => {
    // Tue 8p Los Angeles is Tue 11p New York.
    const post = makePost({ freeTimes: [136], freeTimesZone: 'America/Los_Angeles' });
    const m = mockApi({ ...base, '/api/posts/p1': post, 'PATCH /api/posts/p1': post });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('Chill run'));
    expect(screen.getByRole('button', { name: 'Tue 11p' })).toHaveAttribute('aria-pressed', 'true');
    pickSlot('Wed 1a');
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toEqual({ freeTimes: [142, 146], freeTimesZone: 'America/New_York' });
  });

  it('edits in the saved zone when conversion would split a half hour', async () => {
    const post = makePost({ freeTimes: [147], freeTimesZone: 'Asia/Kathmandu' });
    const m = mockApi({ ...base, '/api/posts/p1': post, 'PATCH /api/posts/p1': post });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('Chill run'));
    expect(screen.getByText(/Editing availability in Asia\/Kathmandu/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Wed 1:30a' })).toHaveAttribute('aria-pressed', 'true');
    pickSlot('Wed 2a');
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toEqual({ freeTimes: [147, 148], freeTimesZone: 'Asia/Kathmandu' });
  });

  it('says "No changes to save." and does not send when nothing changed', async () => {
    const m = mockApi({ ...base, '/api/posts/p1': makePost() });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('Chill run'));
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('No changes to save.');
    expect(writes(m)).toHaveLength(0);
  });

  it('clearing min CP sends null', async () => {
    const m = mockApi({ ...base, '/api/posts/p1': makePost(), 'PATCH /api/posts/p1': makePost() });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Min CP')).toHaveValue('300,000,000'));
    fireEvent.change(screen.getByLabelText('Min CP'), { target: { value: '' } });
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toEqual({ minCp: null });
  });

  it('with 2 members disables type and character and offers party sizes starting at 2', async () => {
    mockApi({ ...base, '/api/posts/p1': makePost({ memberCount: 2, partySize: 3 }) });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('Chill run'));
    expect(screen.getByLabelText('Character')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Recruiting' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Looking for party' })).toBeDisabled();
    expect(screen.getByText("Can't change while others are in the party")).toBeInTheDocument();
    const size = screen.getByLabelText('Party size') as HTMLSelectElement;
    expect(size.options[0].value).toBe('2');
  });

  it('locked-type edit PATCH omits type and characterId', async () => {
    const m = mockApi({ ...base, '/api/posts/p1': makePost({ memberCount: 2 }), 'PATCH /api/posts/p1': makePost() });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('Chill run'));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'x' } });
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toEqual({ note: 'x' });
  });

  it('LFP to recruiting with default size sends type and partySize', async () => {
    const lfp = makePost({ type: 'lfp', partySize: null, minCp: null });
    const m = mockApi({ ...base, '/api/posts/p1': lfp, 'PATCH /api/posts/p1': lfp });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('Chill run'));
    fireEvent.click(screen.getByRole('button', { name: 'Recruiting' }));
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toEqual({ type: 'recruiting', partySize: 4 });
  });

  it('post whose character was deleted can still be edited', async () => {
    const orphan = makePost({ poster: { ...poster, characterId: null, character: null } });
    const m = mockApi({ ...base, '/api/posts/p1': orphan, 'PATCH /api/posts/p1': orphan });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('Chill run'));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'y' } });
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toEqual({ note: 'y' });
  });

  it('non-poster on /posts/:id/edit sees the poster-only message', async () => {
    mockApi({ ...base, '/api/posts/p1': makePost({ isPoster: false }) });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    expect(await screen.findByText('Only the poster can edit this post.')).toBeInTheDocument();
  });
});

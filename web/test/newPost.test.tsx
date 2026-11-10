import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostDetailDTO } from '@pf/shared';
import { App } from '../src/App';
import { localInputToUtcIso, utcIsoToLocalInput } from '../src/components/post/time';
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
  guild: { id: 'g1', name: 'Maple Guild', iconUrl: null },
  screenshotUrl: null,
  owner: { discordUsername: 'lily#1' },
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
  isMine: true,
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
  '/api/auth/me': user,
  '/api/bosses': bosses,
  '/api/characters?mine=1': [lily],
};

const writes = (m: ReturnType<typeof mockApi>) =>
  m.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PATCH');
const body = (call: Parameters<typeof fetch>) => JSON.parse(String(call[1]?.body));

const pickBoss = async (name: string) => fireEvent.click(await screen.findByLabelText(name));
const pickCharacter = async () => fireEvent.change(await screen.findByLabelText('Character'), { target: { value: 'c1' } });
const setWhen = (v: string) => fireEvent.change(screen.getByLabelText('When'), { target: { value: v } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 9, 12, 0));
});
afterEach(() => vi.useRealTimers());

describe('NewPostPage (create)', () => {
  it('recruiting submit', async () => {
    const m = mockApi({ ...base, '/api/posts/p1': makePost(), 'POST /api/posts': makePost() });
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickCharacter();
    await pickBoss('Hard Lucid');
    setWhen('2026-11-10T20:00');
    fireEvent.change(screen.getByLabelText('Party size'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Min CP'), { target: { value: '300,000,000' } });
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(writes(m)).toHaveLength(1);
    expect(body(writes(m)[0])).toEqual({
      type: 'recruiting',
      characterId: 'c1',
      bossDifficultyIds: [7],
      scheduledAt: localInputToUtcIso('2026-11-10T20:00'),
      partySize: 4,
      minCp: 300000000,
      note: '',
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
    setWhen('2026-11-10T20:00');
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toEqual({
      type: 'lfp',
      characterId: 'c1',
      bossDifficultyIds: [7],
      scheduledAt: localInputToUtcIso('2026-11-10T20:00'),
      note: '',
    });
  });

  it('flexible sends scheduledAt null', async () => {
    const m = mockApi({ ...base, '/api/posts/p1': makePost(), 'POST /api/posts': makePost() });
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickCharacter();
    await pickBoss('Hard Lucid');
    fireEvent.click(screen.getByLabelText('Flexible'));
    expect(screen.getByLabelText('When')).toBeDisabled();
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0]).scheduledAt).toBeNull();
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
    setWhen('2026-11-10T20:00');
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick at least one boss.');
    expect(writes(m)).toHaveLength(0);
  });

  it('rejects a time in the past', async () => {
    const m = mockApi(base);
    renderWithProviders(<App />, { route: '/posts/new' });
    await pickCharacter();
    await pickBoss('Hard Lucid');
    setWhen('2026-11-08T20:00');
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a time in the future.');
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
    expect(await screen.findByText('Log in with Discord to post.')).toBeInTheDocument();
  });
});

describe('NewPostPage (edit)', () => {
  it('prefills from the post and PATCHes only changed fields (note + partySize)', async () => {
    const m = mockApi({ ...base, '/api/posts/p1': makePost(), 'PATCH /api/posts/p1': makePost() });
    renderWithProviders(<App />, { route: '/posts/p1/edit' });
    await waitFor(() => expect(screen.getByLabelText('Note')).toHaveValue('Chill run'));
    expect(screen.getByLabelText('When')).toHaveValue('2026-11-10T20:00');
    expect(screen.getByLabelText('Hard Lucid')).toBeChecked();
    expect(screen.getByLabelText('Min CP')).toHaveValue('300,000,000');
    expect(screen.getByLabelText('Party size')).toHaveValue('4');
    expect(utcIsoToLocalInput(makePost().scheduledAt!)).toBe('2026-11-10T20:00');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'New note' } });
    fireEvent.change(screen.getByLabelText('Party size'), { target: { value: '5' } });
    save();
    await screen.findByRole('heading', { name: 'Lineup' });
    expect(body(writes(m)[0])).toEqual({ partySize: 5, note: 'New note' });
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

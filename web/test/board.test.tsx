import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostSummaryDTO } from '@pf/shared';
import { App } from '../src/App';
import { mockApi, renderWithProviders, testQueryClient } from './setup';

const tz = vi.hoisted(() => ({ zone: 'America/New_York' }));
vi.mock('../src/lib/timeZone', () => ({ browserTimeZone: () => tz.zone }));

const user = { id: 'u1', discordUsername: 'maple_fan', avatarUrl: null, isAdmin: false };

const character: CharacterDTO = {
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
  owner: { discordUsername: 'lily#1', displayName: null },
  isOwner: false,
  syncStatus: 'ok',
  lastSyncedAt: '2026-11-01T00:00:00Z',
};

const poster: PartyMemberDTO = {
  id: 'm1',
  role: 'poster',
  characterId: 'c1',
  cpAtJoin: 1_500_000_000,
  joinedAt: '2026-11-09T00:00:00Z',
  character,
  snapshot: { ign: 'Lily', jobName: 'Bishop', level: 280, imageUrl: 'http://img/lily.png', worldName: 'Kronos', guildName: 'Maple Guild' },
  freeTimes: [], freeTimesZone: null, isMine: false,
};

const post: PostSummaryDTO = {
  id: 'p1',
  type: 'recruiting',
  world: { id: 5, name: 'Kronos' },
  guild: { id: 'g1', name: 'Maple Guild' },
  poster,
  bosses: [{ bossDifficultyId: 7, bossName: 'Lucid', difficulty: 'Hard' }],
  scheduledAt: null,
  freeTimes: [],
  weeklyTimeZone: null, freeTimesZone: null,
  expiresAt: '2026-11-16T00:00:00Z',
  createdAt: '2026-11-09T00:00:00Z',
  partySize: 4,
  memberCount: 2,
  minCp: 300_000_000,
  note: 'Chill run',
  status: 'open',
  deleted: false,
  isPoster: false,
};

const base = {
  '/api/worlds': [{ id: 5, nexonWorldId: 5, name: 'Kronos', worldType: 'normal', active: true }],
  '/api/guilds': [],
  '/api/bosses': [{ id: 1, name: 'Lucid', difficulties: [{ id: 7, difficulty: 'Hard', partyCap: 6 }] }],
  '/api/rarity-tiers': [{ id: 1, name: 'Common', minCp: 0, sortOrder: 0 }],
};

const postsCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/posts') && !u.startsWith('/api/posts/'));

describe('BoardPage', () => {
  it('renders posts as rows with type badge, bosses, time, slots 2 / 4', async () => {
    mockApi({ ...base, '/api/auth/me': null, '/api/posts': [post] });
    renderWithProviders(<App />);
    expect(await screen.findByText('Recruiting', { selector: '.post-badge' })).toBeInTheDocument();
    expect(screen.getByText('Hard Lucid')).toBeInTheDocument();
    expect(screen.getByText('2 / 4')).toBeInTheDocument();
    expect(screen.getByText('Flexible', { selector: '.post-row__when' })).toBeInTheDocument();
  });

  it('logged-in user with a Kronos character sends worldIds on the first request', async () => {
    const fetchMock = mockApi({
      ...base,
      '/api/auth/me': user,
      '/api/characters?mine=1': [character],
      '/api/posts?worldIds=5': [post],
    });
    renderWithProviders(<App />);
    expect(await screen.findByText('2 / 4')).toBeInTheDocument();
    expect(postsCalls(fetchMock)).toEqual(['/api/posts?worldIds=5']);
  });

  it('logged-out users never request their own characters', async () => {
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [post] });
    renderWithProviders(<App />);
    await screen.findByText('2 / 4');
    expect(fetchMock.mock.calls.map(([u]) => String(u)).some((u) => u.includes('mine=1'))).toBe(false);
  });

  it('still loads the board (all worlds) when /api/auth/me fails', async () => {
    const fetchMock = mockApi({ ...base, '/api/posts': [post] });
    renderWithProviders(<App />);
    expect(await screen.findByText('2 / 4')).toBeInTheDocument();
    expect(postsCalls(fetchMock)).toEqual(['/api/posts']);
  });

  it.each([['recruiting', 'Recruiting'], ['carrying', 'Carrying']] as const)('choosing type %s refetches with that category', async (type, label) => {
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], [`/api/posts?type=${type}`]: [{ ...post, type }] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    fireEvent.click(screen.getByRole('radio', { name: label }));
    expect(await screen.findByText('2 / 4')).toBeInTheDocument();
    expect(postsCalls(fetchMock)).toContain(`/api/posts?type=${type}`);
  });

  afterEach(() => {
    vi.useRealTimers();
    tz.zone = 'America/New_York';
  });

  it('the post list re-checks for new posts every 30s and when the tab regains focus', async () => {
    const client = testQueryClient();
    mockApi({ ...base, '/api/auth/me': null, '/api/posts': [] });
    renderWithProviders(<App />, { client });
    await screen.findByText('No open posts match. Be the first to post!');
    const [q] = client.getQueryCache().findAll({ queryKey: ['posts', 'board'] });
    expect(q.options).toMatchObject({ refetchInterval: 30_000, refetchOnWindowFocus: true });
  });

  it('has no finalized-time filter', async () => {
    mockApi({ ...base, '/api/auth/me': null, '/api/posts': [] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    expect(screen.queryByRole('radiogroup', { name: 'When' })).toBeNull();
    expect(screen.queryByText('Finalized time')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Availability' })).toBeNull();
  });

  it('choosing a boss from the menu sends bossId and enables Difficulty', async () => {
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], '/api/posts?bossId=1': [post] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    expect(screen.getByRole('button', { name: /Difficulty/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Boss/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lucid' }));
    await waitFor(() => expect(postsCalls(fetchMock)).toContain('/api/posts?bossId=1'));
    expect(screen.getByRole('button', { name: /Difficulty/ })).toBeEnabled();
  });

  it('world chips: default pressed, deselecting every world drops worldIds, toggling adds it back', async () => {
    const fetchMock = mockApi({
      ...base,
      '/api/auth/me': user,
      '/api/characters?mine=1': [character],
      '/api/posts?worldIds=5': [post],
      '/api/posts': [post],
    });
    renderWithProviders(<App />);
    const kronos = await screen.findByRole('button', { name: 'Kronos' });
    await screen.findByText('2 / 4');
    expect(kronos).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(kronos);
    expect(kronos).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(postsCalls(fetchMock)).toEqual(['/api/posts?worldIds=5', '/api/posts']));
    fireEvent.click(kronos);
    await waitFor(() => expect(postsCalls(fetchMock)).toEqual(['/api/posts?worldIds=5', '/api/posts', '/api/posts?worldIds=5']));
  });

  it('shows the empty state', async () => {
    mockApi({ ...base, '/api/auth/me': null, '/api/posts': [] });
    renderWithProviders(<App />);
    expect(await screen.findByText('No open posts match. Be the first to post!')).toBeInTheDocument();
  });

  it('row links to /posts/:id', async () => {
    mockApi({ ...base, '/api/auth/me': null, '/api/posts': [post] });
    renderWithProviders(<App />);
    const row = (await screen.findByText('2 / 4')).closest('a');
    expect(row).toHaveAttribute('href', '/posts/p1');
  });

  it('falls back to the snapshot when the poster character is deleted', async () => {
    const gone = {
      ...post,
      poster: { ...poster, character: null, characterId: null, snapshot: { ...poster.snapshot, imageUrl: 'http://img/snap.png' } },
    };
    mockApi({ ...base, '/api/auth/me': null, '/api/posts': [gone] });
    renderWithProviders(<App />);
    const row = await screen.findByRole('option', { name: /Hard Lucid/ });
    expect(row).toHaveTextContent('Lily · Maple Guild');
    expect(row.querySelector('img')).toHaveAttribute('src', 'http://img/snap.png');
  });

  it('shows New post only when logged in', async () => {
    mockApi({ ...base, '/api/auth/me': user, '/api/characters?mine=1': [], '/api/posts': [] });
    renderWithProviders(<App />);
    expect(await screen.findByRole('link', { name: 'New post' })).toHaveAttribute('href', '/posts/new');
  });
});

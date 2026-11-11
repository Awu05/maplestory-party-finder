import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostSummaryDTO } from '@pf/shared';
import { App } from '../src/App';
import { boardQueryString } from '../src/api/postHooks';
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
  });

  // The start of the viewer's Tue 8p half hour (Tue 8pm EST).
  const FREE_AT = '/api/posts?freeAt=2026-11-11T01%3A00%3A00.000Z&freeFor=30';
  const pickTue8p = async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Day/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Tue' }));
    fireEvent.click(screen.getByRole('button', { name: /^Time/ }));
    fireEvent.click(await screen.findByRole('option', { name: '8p' }));
  };

  it('Free at Tue 8p in the viewer zone sends the next occurrence as freeAt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], [FREE_AT]: [post] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    expect(screen.getByRole('button', { name: /^Time/ })).toBeDisabled();
    await pickTue8p();
    await waitFor(() => expect(postsCalls(fetchMock)).toContain(FREE_AT));
  });

  it('uses the saved 24-hour format for the time filter', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    window.localStorage.setItem('partyFinder.timeFormat', '24h');
    try {
      const freeAt = '/api/posts?freeAt=2026-11-11T01%3A30%3A00.000Z&freeFor=30';
      const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], [freeAt]: [post] });
      renderWithProviders(<App />);
      await screen.findByText('No open posts match. Be the first to post!');
      fireEvent.click(screen.getByRole('button', { name: /^Day/ }));
      fireEvent.click(await screen.findByRole('option', { name: 'Tue' }));
      fireEvent.click(screen.getByRole('button', { name: /^Time/ }));
      fireEvent.click(await screen.findByRole('option', { name: '20:30' }));
      await waitFor(() => expect(postsCalls(fetchMock)).toContain(freeAt));
      expect(screen.getByRole('button', { name: /^Time/ })).toHaveTextContent('20:30');
    } finally {
      window.localStorage.removeItem('partyFinder.timeFormat');
    }
  });

  it('a Kolkata viewer sends the start of their chosen half-hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    tz.zone = 'Asia/Kolkata';
    // Wed 6:30a IST is slot 157, or Tue 8pm in New York.
    expect(boardQueryString({ freeAt: 157 })).toBe('freeAt=2026-11-11T01%3A00%3A00.000Z&freeFor=30');
  });

  it('shows only the selected day and waits for a time before filtering', async () => {
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    fireEvent.click(screen.getByRole('button', { name: /^Day/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Tue' }));
    expect(screen.getByRole('button', { name: 'Day: Tue' })).toBeInTheDocument();
    expect(postsCalls(fetchMock).every((u) => !u.includes('freeAt'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Time/ }));
    fireEvent.click(await screen.findByRole('option', { name: '8p' }));
    expect(screen.getByRole('button', { name: /^Day/ })).not.toHaveTextContent('pick a time');
  });

  it('the board query key holds the freeAt instant, so a passed occurrence is never served from cache', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    const client = testQueryClient();
    mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], [FREE_AT]: [post] });
    renderWithProviders(<App />, { client });
    await screen.findByText('No open posts match. Be the first to post!');
    await pickTue8p();
    await screen.findByText('2 / 4');
    const keys = client.getQueryCache().findAll({ queryKey: ['posts', 'board'] }).map((q) => q.queryKey);
    expect(keys).toContainEqual(['posts', 'board', expect.objectContaining({ freeAt: 136 }), '2026-11-11T01:00:00.000Z']);
  });

  it('Any time clears freeAt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], [FREE_AT]: [post] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    await pickTue8p();
    await screen.findByText('2 / 4');
    fireEvent.click(screen.getByRole('button', { name: /^Day/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Any day' }));
    await waitFor(() => expect(postsCalls(fetchMock).at(-1)).toBe('/api/posts'));
    expect(screen.getByRole('button', { name: /^Time/ })).toBeDisabled();
  });

  it('Free at works with the keyboard only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], [FREE_AT]: [post] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });
    const day = screen.getByRole('button', { name: /^Day/ });
    day.focus();
    key(day, 'Enter');
    const dayList = await screen.findByRole('listbox', { name: 'Day' });
    expect(dayList).toHaveFocus();
    // Any time, Sun, Mon, Tue
    for (let i = 0; i < 3; i++) key(dayList, 'ArrowDown');
    key(dayList, 'Enter');
    const hour = screen.getByRole('button', { name: /^Time/ });
    expect(hour).toBeEnabled();
    hour.focus();
    key(hour, 'ArrowDown');
    const hourList = await screen.findByRole('listbox', { name: 'Time' });
    // Any hour, then 40 half-hour slots before 8p.
    for (let i = 0; i < 41; i++) key(hourList, 'ArrowDown');
    key(hourList, 'Enter');
    await waitFor(() => expect(postsCalls(fetchMock)).toContain(FREE_AT));
  });

  it('Reset clears the free-time day and time, and is disabled when nothing is picked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], [FREE_AT]: [post] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    const reset = screen.getByRole('button', { name: 'Reset free time' });
    expect(reset).toBeDisabled();
    await pickTue8p();
    await screen.findByText('2 / 4');
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    await waitFor(() => expect(postsCalls(fetchMock).at(-1)).toBe('/api/posts'));
    expect(screen.getByRole('button', { name: /^Day/ })).not.toHaveTextContent('Tue');
    expect(screen.getByRole('button', { name: /^Time/ })).toBeDisabled();
    expect(reset).toBeDisabled();
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

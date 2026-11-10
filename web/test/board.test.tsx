import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostSummaryDTO } from '@pf/shared';
import { SCHEDULED_GRACE_MS } from '@pf/shared';
import { App } from '../src/App';
import { boardQueryString } from '../src/api/postHooks';
import { mockApi, renderWithProviders } from './setup';

const tz = vi.hoisted(() => ({ zone: 'America/New_York' }));
vi.mock('../src/components/post/time', async (orig) => ({
  ...(await orig<typeof import('../src/components/post/time')>()),
  browserTimeZone: () => tz.zone,
}));

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
  isMine: false,
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
  freeTimesZone: null,
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

  it('choosing type Recruiting refetches with type=recruiting', async () => {
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], '/api/posts?type=recruiting': [post] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    fireEvent.click(screen.getByRole('radio', { name: 'Recruiting' }));
    expect(await screen.findByText('2 / 4')).toBeInTheDocument();
    expect(postsCalls(fetchMock)).toContain('/api/posts?type=recruiting');
  });

  afterEach(() => {
    vi.useRealTimers();
    tz.zone = 'America/New_York';
  });

  it('When chips read Any, Next 24h, This week, Not set', async () => {
    mockApi({ ...base, '/api/auth/me': null, '/api/posts': [] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    const group = screen.getByRole('radiogroup', { name: 'When' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Any', 'Next 24h', 'This week', 'Not set']);
  });

  // The last minute of the viewer's Tue 8p hour (Tue 8:59pm EST).
  const FREE_AT = '/api/posts?freeAt=2026-11-11T01%3A59%3A00.000Z';
  const pickTue8p = async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Free at/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Tue' }));
    fireEvent.click(screen.getByRole('button', { name: /^Hour/ }));
    fireEvent.click(await screen.findByRole('option', { name: '8p' }));
  };

  it('Free at Tue 8p in the viewer zone sends the next occurrence as freeAt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], [FREE_AT]: [post] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    expect(screen.getByRole('button', { name: /^Hour/ })).toBeDisabled();
    await pickTue8p();
    await waitFor(() => expect(postsCalls(fetchMock)).toContain(FREE_AT));
  });

  it('a Kolkata viewer sends the last minute of their chosen hour, the instant a NY post free at that cell matches', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    tz.zone = 'Asia/Kolkata';
    // Wed 6a IST is hour-of-week 78; its last minute, 6:59 IST, is 01:29Z (Tue 8:29pm in New York).
    expect(boardQueryString({ freeAt: 78 })).toBe('freeAt=2026-11-11T01%3A29%3A00.000Z');
  });

  it('a day without an hour reads "<Day> · pick an hour" and sends no freeAt', async () => {
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    fireEvent.click(screen.getByRole('button', { name: /^Free at/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Tue' }));
    expect(screen.getByRole('button', { name: /^Free at/ })).toHaveTextContent('Free at: Tue · pick an hour');
    expect(postsCalls(fetchMock).every((u) => !u.includes('freeAt'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Hour/ }));
    fireEvent.click(await screen.findByRole('option', { name: '8p' }));
    expect(screen.getByRole('button', { name: /^Free at/ })).not.toHaveTextContent('pick an hour');
  });

  it('Any time clears freeAt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], [FREE_AT]: [post] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    await pickTue8p();
    await screen.findByText('2 / 4');
    fireEvent.click(screen.getByRole('button', { name: /^Free at/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Any time' }));
    await waitFor(() => expect(postsCalls(fetchMock).at(-1)).toBe('/api/posts'));
    expect(screen.getByRole('button', { name: /^Hour/ })).toBeDisabled();
  });

  it('Free at works with the keyboard only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], [FREE_AT]: [post] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });
    const day = screen.getByRole('button', { name: /^Free at/ });
    day.focus();
    key(day, 'Enter');
    const dayList = await screen.findByRole('listbox', { name: 'Free at' });
    expect(dayList).toHaveFocus();
    // Any time, Sun, Mon, Tue
    for (let i = 0; i < 3; i++) key(dayList, 'ArrowDown');
    key(dayList, 'Enter');
    const hour = screen.getByRole('button', { name: /^Hour/ });
    expect(hour).toBeEnabled();
    hour.focus();
    key(hour, 'ArrowDown');
    const hourList = await screen.findByRole('listbox', { name: 'Hour' });
    // Any hour, 12a ... 8p is index 1 + 20
    for (let i = 0; i < 21; i++) key(hourList, 'ArrowDown');
    key(hourList, 'Enter');
    await waitFor(() => expect(postsCalls(fetchMock)).toContain(FREE_AT));
  });

  it('When=Not set sends flexible=1', async () => {
    const fetchMock = mockApi({ ...base, '/api/auth/me': null, '/api/posts': [], '/api/posts?flexible=1': [post] });
    renderWithProviders(<App />);
    await screen.findByText('No open posts match. Be the first to post!');
    fireEvent.click(screen.getByRole('radio', { name: 'Not set' }));
    await waitFor(() => expect(postsCalls(fetchMock)).toContain('/api/posts?flexible=1'));
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

describe('boardQueryString', () => {
  const now = new Date('2026-11-09T12:00:00.000Z');
  const range = (qs: string) => {
    const p = new URLSearchParams(qs);
    return { from: p.get('from'), to: p.get('to') };
  };

  it('Next 24h starts a grace period back, so runs that just started (still on the board) match', () => {
    expect(range(boardQueryString({ when: '24h' }, now))).toEqual({
      from: new Date(now.getTime() - SCHEDULED_GRACE_MS).toISOString(),
      to: '2026-11-10T12:00:00.000Z',
    });
  });

  it('This week starts a grace period back and ends 7 days ahead', () => {
    expect(range(boardQueryString({ when: '7d' }, now))).toEqual({
      from: new Date(now.getTime() - SCHEDULED_GRACE_MS).toISOString(),
      to: '2026-11-16T12:00:00.000Z',
    });
  });
});

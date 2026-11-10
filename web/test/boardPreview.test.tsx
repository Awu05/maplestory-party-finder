import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostDetailDTO, PostSummaryDTO } from '@pf/shared';
import { App } from '../src/App';
import { mockApi, renderWithProviders, testQueryClient } from './setup';

const character = (id: string, ign: string): CharacterDTO => ({
  id,
  ign,
  world: { id: 5, name: 'Kronos' },
  jobName: 'Bishop', archetype: 'magician',
  level: 280,
  imageUrl: `http://img/${ign}.png`,
  combatPower: 1_500_000_000,
  cpUpdatedAt: '2026-11-01T00:00:00Z',
  guild: { id: 'g1', name: 'Maple Guild', iconUrl: null }, manual: false,
  screenshotUrl: null,
  owner: { discordUsername: `${ign}#1` },
  isOwner: false,
  syncStatus: 'ok',
  lastSyncedAt: '2026-11-01T00:00:00Z',
});

const member = (id: string, ign: string, role: 'poster' | 'member'): PartyMemberDTO => ({
  id,
  role,
  characterId: `c-${id}`,
  cpAtJoin: 1_500_000_000,
  joinedAt: '2026-11-09T00:00:00Z',
  character: character(`c-${id}`, ign),
  snapshot: { ign, jobName: 'Bishop', level: 280, imageUrl: `http://img/${ign}.png`, worldName: 'Kronos', guildName: 'Maple Guild' },
  isMine: false,
});

const lily = member('m1', 'Lily', 'poster');
const bob = member('m2', 'Bob', 'member');

const p1: PostSummaryDTO = {
  id: 'p1',
  type: 'lfp',
  world: { id: 5, name: 'Kronos' },
  guild: { id: 'g1', name: 'Maple Guild' },
  poster: lily,
  bosses: [{ bossDifficultyId: 7, bossName: 'Lucid', difficulty: 'Hard' }],
  scheduledAt: null,
  expiresAt: '2026-11-16T00:00:00Z',
  createdAt: '2026-11-09T00:00:00Z',
  partySize: null,
  memberCount: 1,
  minCp: null,
  note: '',
  status: 'open',
  deleted: false,
  isPoster: false,
};
const p2: PostSummaryDTO = {
  ...p1,
  id: 'p2',
  type: 'recruiting',
  bosses: [{ bossDifficultyId: 8, bossName: 'Will', difficulty: 'Normal' }],
  partySize: 4,
  memberCount: 2,
  minCp: 300_000_000,
  note: 'Chill run',
};
const detail = (s: PostSummaryDTO, over: Partial<PostDetailDTO> = {}): PostDetailDTO => ({
  ...s,
  members: s.id === 'p2' ? [lily, bob] : [lily],
  isMember: false,
  incomingRequests: [],
  sentInvites: [],
  myPending: [],
  receivedInvites: [],
  sentInvitesToThis: [],
  canRenew: false,
  ...over,
});

const base = {
  '/api/auth/me': null,
  '/api/worlds': [{ id: 5, nexonWorldId: 5, name: 'Kronos', worldType: 'normal', active: true }],
  '/api/guilds': [{ id: 'g1', name: 'Maple Guild' }],
  '/api/bosses': [],
  '/api/rarity-tiers': [{ id: 1, name: 'Common', minCp: 0, sortOrder: 0 }],
  '/api/posts': [p1, p2],
  '/api/posts/p1': detail(p1),
  '/api/posts/p2': detail(p2),
};

const renderBoard = (route = '/?post=p2') => renderWithProviders(<App />, { route });
const preview = () => screen.findByRole('region', { name: 'Post preview' });

describe('Board preview', () => {
  it('fetches the selected post and shows bosses, meta, min CP, note and a compact lineup', async () => {
    const fetchMock = mockApi(base);
    renderBoard();
    const pane = await preview();
    expect(await within(pane).findByRole('heading', { name: 'Normal Will' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toContain('/api/posts/p2');
    expect(within(pane).getByText('Open')).toBeInTheDocument();
    expect(within(pane).getByText(/Flexible · Kronos · Maple Guild/)).toBeInTheDocument();
    expect(within(pane).getByText('Min CP 300M')).toBeInTheDocument();
    expect(within(pane).getByText('Chill run')).toBeInTheDocument();
    const lineup = within(pane).getByRole('list', { name: 'Lineup' });
    expect(within(lineup).getByText('Lily')).toBeInTheDocument();
    expect(within(lineup).getByText('Bob')).toBeInTheDocument();
    expect(within(lineup).getAllByText('Open slot')).toHaveLength(2);
    expect(within(lineup).queryByText(/CP at join/)).not.toBeInTheDocument();
  });

  it('Request to join from the preview POSTs /api/posts/p2/requests', async () => {
    const fetchMock = mockApi({
      ...base,
      '/api/auth/me': { id: 'u1', discordUsername: 'me#1', avatarUrl: null, isAdmin: false },
      '/api/characters?mine=1': [character('k1', 'KronosMain')],
      '/api/posts?worldIds=5': [p1, p2],
      '/api/me/parties': [],
      '/api/me/posts': [],
      'POST /api/posts/p2/requests': {},
    });
    renderBoard();
    const pane = await preview();
    fireEvent.click(await within(pane).findByRole('button', { name: 'Request to join' }));
    fireEvent.click(await within(pane).findByRole('button', { name: /KronosMain/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u) === '/api/posts/p2/requests' && i?.method === 'POST')).toBe(true),
    );
  });

  const loggedIn = {
    ...base,
    '/api/auth/me': { id: 'u1', discordUsername: 'me#1', avatarUrl: null, isAdmin: false },
    '/api/characters?mine=1': [character('k1', 'KronosMain')],
    '/api/posts?worldIds=5': [p1, p2],
    '/api/me/parties': [],
    '/api/me/posts': [],
  };

  it("hides Request to join on the poster's own recruiting post", async () => {
    mockApi({ ...loggedIn, '/api/posts/p2': detail({ ...p2, isPoster: true }) });
    renderBoard();
    const pane = await preview();
    await screen.findByText('me#1');
    expect(await within(pane).findByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(within(pane).queryByRole('button', { name: 'Request to join' })).not.toBeInTheDocument();
    expect(within(pane).queryByRole('region', { name: 'Your actions' })).not.toBeInTheDocument();
  });

  it("hides Invite on the poster's own LFP post", async () => {
    mockApi({ ...loggedIn, '/api/posts/p1': detail({ ...p1, isPoster: true }) });
    renderBoard('/?post=p1');
    const pane = await preview();
    await screen.findByText('me#1');
    expect(await within(pane).findByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(within(pane).queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument();
    expect(within(pane).queryByRole('region', { name: 'Your actions' })).not.toBeInTheDocument();
  });

  it('resets the action error when another (cached) post is selected', async () => {
    mockApi(loggedIn); // no POST mock: the request fails with not_found
    const client = testQueryClient();
    client.setQueryDefaults(['posts'], { gcTime: Infinity });
    client.setQueryData(['posts', 'detail', 'p1'], detail(p1));
    renderWithProviders(<App />, { route: '/?post=p2', client });
    const pane = await preview();
    fireEvent.click(await within(pane).findByRole('button', { name: 'Request to join' }));
    fireEvent.click(await within(pane).findByRole('button', { name: /KronosMain/ }));
    expect(await within(pane).findByRole('alert')).toBeInTheDocument();
    const rows = within(screen.getByRole('listbox', { name: 'Posts' })).getAllByRole('option');
    fireEvent.click(rows.find((r) => r.textContent?.includes('Lucid'))!);
    expect(await within(pane).findByRole('heading', { name: 'Hard Lucid' })).toBeInTheDocument();
    expect(within(pane).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows Edit for the poster only, and Open post for everyone', async () => {
    mockApi({ ...base, '/api/posts/p2': detail({ ...p2, isPoster: true }) });
    renderBoard();
    const pane = await preview();
    expect(await within(pane).findByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/posts/p2/edit');
    expect(within(pane).getByRole('link', { name: 'Open post' })).toHaveAttribute('href', '/posts/p2');
  });

  it.each([
    ['closed', { status: 'closed' as const }],
    ['deleted', { deleted: true }],
  ])("hides Edit on the poster's own %s post", async (_name, over) => {
    mockApi({ ...base, '/api/posts/p2': detail({ ...p2, isPoster: true, ...over }) });
    renderBoard();
    const pane = await preview();
    expect(await within(pane).findByRole('link', { name: 'Open post' })).toHaveAttribute('href', '/posts/p2');
    expect(within(pane).queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('hides Edit from a non-poster', async () => {
    mockApi(base);
    renderBoard();
    const pane = await preview();
    expect(await within(pane).findByRole('link', { name: 'Open post' })).toHaveAttribute('href', '/posts/p2');
    expect(within(pane).queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows the friendly message when the preview fetch fails', async () => {
    const { '/api/posts/p2': _omit, ...rest } = base;
    mockApi(rest);
    renderBoard();
    const pane = await preview();
    expect(await within(pane).findByRole('alert')).toBeInTheDocument();
  });

  it('shows no placeholder when there are no posts', async () => {
    mockApi({ ...base, '/api/posts': [] });
    renderBoard('/');
    expect(await screen.findByText('No open posts match. Be the first to post!')).toBeInTheDocument();
    expect(screen.queryByText('Pick a post to see its party')).not.toBeInTheDocument();
  });
});

describe('Board list refetch indicator', () => {
  it('marks the listbox aria-busy while a filter change refetches', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = mockApi({ ...base, '/api/posts?type=lfp': [p1] });
    const real = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) =>
      String(input) === '/api/posts?type=lfp' ? gate.then(() => real(input, init)) : real(input, init),
    );
    renderBoard();
    const list = await screen.findByRole('listbox', { name: 'Posts' });
    await within(list).findAllByRole('option');
    expect(list).not.toHaveAttribute('aria-busy');
    fireEvent.click(screen.getByRole('radio', { name: 'LFP' }));
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Posts' })).toHaveAttribute('aria-busy', 'true'));
    release();
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Posts' })).not.toHaveAttribute('aria-busy'));
  });
});

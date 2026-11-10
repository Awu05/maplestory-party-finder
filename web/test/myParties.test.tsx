import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostDetailDTO, RequestWithPostDTO } from '@pf/shared';
import { MyPartiesPage } from '../src/pages/MyPartiesPage';
import { mockApi, renderWithProviders } from './setup';

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
  owner: { discordUsername: `${ign}#1`, displayName: null },
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

const post = (id: string, boss: string, over: Partial<PostDetailDTO> = {}): PostDetailDTO => {
  const poster = member(`${id}-m1`, `Poster${id}`, 'poster');
  return {
    id,
    type: 'recruiting',
    world: { id: 5, name: 'Kronos' },
    guild: { id: 'g1', name: 'Maple Guild' },
    poster,
    bosses: [{ bossDifficultyId: 7, bossName: boss, difficulty: 'Hard' }],
    scheduledAt: '2026-12-01T20:00:00Z',
    expiresAt: '2026-12-02T00:00:00Z',
    createdAt: '2026-11-09T00:00:00Z',
    partySize: 4,
    memberCount: 2,
    minCp: null,
    note: '',
    status: 'open',
    deleted: false,
    isPoster: false,
    members: [poster, member(`${id}-m2`, `Member${id}`, 'member')],
    isMember: true,
    incomingRequests: [],
    sentInvites: [],
    myPending: [],
    receivedInvites: [],
    sentInvitesToThis: [],
    canRenew: false,
    ...over,
  };
};

const reqWithPost = (id: string, kind: 'invite' | 'join_request', ign: string, p: PostDetailDTO): RequestWithPostDTO => ({
  id,
  kind,
  status: 'pending',
  postId: p.id,
  lfpPostId: null,
  character: character(`rc-${id}`, ign),
  createdAt: '2026-11-09T00:00:00Z',
  decidedAt: null,
  post: p,
});

const base = {
  '/api/rarity-tiers': [{ id: 1, name: 'Common', minCp: 0, sortOrder: 0 }],
  '/api/auth/me': { id: 'u1', discordUsername: 'me#1', avatarUrl: null, isAdmin: false },
  '/api/me/parties': [],
  '/api/me/posts': [],
  '/api/me/requests': { incomingInvites: [], outgoingRequests: [] },
};

function renderPage(routes: Record<string, unknown>, route = '/me/parties') {
  const fetchMock = mockApi({ ...base, ...routes });
  renderWithProviders(
    <Routes>
      <Route path="/me/parties" element={<MyPartiesPage />} />
      <Route path="/posts/:id" element={<h1>Post page</h1>} />
    </Routes>,
    { route },
  );
  return fetchMock;
}

const called = (fetchMock: ReturnType<typeof mockApi>, url: string, method: string) =>
  fetchMock.mock.calls.some(([u, i]) => String(u) === url && (i?.method ?? 'GET') === method);

afterEach(() => vi.restoreAllMocks());

describe('MyPartiesPage', () => {
  it('parties tab splits upcoming and past and renders lineup cards, including a deleted post with its lineup', async () => {
    renderPage({
      '/api/me/parties': [
        post('p1', 'Lucid'),
        post('p2', 'Will', { status: 'full' }),
        post('p3', 'Zakum', { status: 'closed' }),
        post('p4', 'Hilla', { deleted: true }),
      ],
    });
    const upcoming = await screen.findByRole('region', { name: 'Upcoming' });
    expect(within(upcoming).getAllByText(/Lucid/).length).toBeGreaterThan(0);
    expect(within(upcoming).getAllByText(/Will/).length).toBeGreaterThan(0);
    expect(within(upcoming).getByText('Open')).toBeInTheDocument();
    expect(within(upcoming).getByText('Full')).toBeInTheDocument();
    expect(within(upcoming).getByText('Memberp1')).toBeInTheDocument();
    const past = screen.getByRole('region', { name: 'Past' });
    expect(within(past).getAllByText(/Zakum/).length).toBeGreaterThan(0);
    expect(within(past).getByText('Closed')).toBeInTheDocument();
    expect(within(past).getAllByText(/Hilla/).length).toBeGreaterThan(0);
    expect(within(past).getByText('Deleted')).toBeInTheDocument();
    expect(within(past).getByText('Memberp4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Leave' })).toBeNull();
    expect(within(upcoming).getAllByRole('link', { name: 'View post' })[0]).toHaveAttribute('href', '/posts/p1');
  });

  it('?tab=posts shows my posts', async () => {
    renderPage(
      { '/api/me/posts': [{ ...post('p1', 'Lucid'), isPoster: true }, { ...post('p2', 'Will', { status: 'closed' }), isPoster: true }] },
      '/me/parties?tab=posts',
    );
    expect(await screen.findByText(/Lucid/)).toBeInTheDocument();
    expect(screen.getByText(/Will/)).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('requests tab: Accept on an invite posts /api/requests/:id/accept and navigates to /posts/:postId', async () => {
    const p = post('p9', 'Lucid');
    const fetchMock = renderPage(
      {
        '/api/me/requests': { incomingInvites: [reqWithPost('r1', 'invite', 'MyMain', p)], outgoingRequests: [] },
        'POST /api/requests/r1/accept': p,
      },
      '/me/parties?tab=requests',
    );
    expect(await screen.findByText('Invite for MyMain')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(called(fetchMock, '/api/requests/r1/accept', 'POST')).toBe(true));
    expect(await screen.findByRole('heading', { name: 'Post page' })).toBeInTheDocument();
  });

  it('Decline an invite posts /api/requests/:id/decline', async () => {
    const fetchMock = renderPage(
      {
        '/api/me/requests': { incomingInvites: [reqWithPost('r1', 'invite', 'MyMain', post('p9', 'Lucid'))], outgoingRequests: [] },
        'POST /api/requests/r1/decline': {},
      },
      '/me/parties?tab=requests',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(called(fetchMock, '/api/requests/r1/decline', 'POST')).toBe(true));
  });

  it('Cancel outgoing request', async () => {
    const fetchMock = renderPage(
      {
        '/api/me/requests': { incomingInvites: [], outgoingRequests: [reqWithPost('r2', 'join_request', 'MyMain', post('p9', 'Lucid'))] },
        'POST /api/requests/r2/cancel': {},
      },
      '/me/parties?tab=requests',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(called(fetchMock, '/api/requests/r2/cancel', 'POST')).toBe(true));
  });

  it('empty states', async () => {
    renderPage({}, '/me/parties');
    expect(await screen.findByText('No upcoming parties.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'My posts' }));
    expect(await screen.findByText("You haven't posted anything.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Requests & invites' }));
    expect(await screen.findByText('No invites.')).toBeInTheDocument();
    expect(screen.getByText('No outgoing requests.')).toBeInTheDocument();
  });

  it('logged out shows login prompt', async () => {
    renderPage({ '/api/auth/me': null });
    expect(await screen.findByText('Log in with Discord to see your parties.')).toBeInTheDocument();
  });
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostDetailDTO, RequestDTO } from '@pf/shared';
import { PostDetailPage } from '../src/pages/PostDetailPage';
import { mockApi, renderWithProviders } from './setup';

const character = (id: string, ign: string, cp = 1_500_000_000): CharacterDTO => ({
  id,
  ign,
  world: { id: 5, name: 'Kronos' },
  jobName: 'Bishop',
  level: 280,
  imageUrl: `http://img/${ign}.png`,
  combatPower: cp,
  cpUpdatedAt: '2026-11-01T00:00:00Z',
  guild: { id: 'g1', name: 'Maple Guild', iconUrl: null },
  screenshotUrl: null,
  owner: { discordUsername: `${ign}#1` },
  isOwner: false,
  syncStatus: 'ok',
  lastSyncedAt: '2026-11-01T00:00:00Z',
});

const member = (id: string, ign: string, role: 'poster' | 'member', over: Partial<PartyMemberDTO> = {}): PartyMemberDTO => ({
  id,
  role,
  characterId: `c-${id}`,
  cpAtJoin: 1_500_000_000,
  joinedAt: '2026-11-09T00:00:00Z',
  character: character(`c-${id}`, ign),
  snapshot: { ign, jobName: 'Bishop', level: 280, imageUrl: `http://img/${ign}.png`, worldName: 'Kronos', guildName: 'Maple Guild' },
  isMine: false,
  ...over,
});

const request = (id: string, ign: string, cp: number, kind: RequestDTO['kind'] = 'join_request'): RequestDTO => ({
  id,
  kind,
  status: 'pending',
  postId: 'p1',
  lfpPostId: null,
  character: character(`rc-${id}`, ign, cp),
  createdAt: '2026-11-09T00:00:00Z',
  decidedAt: null,
});

const post = (over: Partial<PostDetailDTO> = {}): PostDetailDTO => {
  const poster = member('m1', 'Lily', 'poster');
  return {
    id: 'p1',
    type: 'recruiting',
    world: { id: 5, name: 'Kronos' },
    guild: { id: 'g1', name: 'Maple Guild' },
    poster,
    bosses: [{ bossDifficultyId: 7, bossName: 'Lucid', difficulty: 'Hard' }],
    scheduledAt: '2026-12-01T20:00:00Z',
    expiresAt: '2026-12-02T00:00:00Z',
    createdAt: '2026-11-09T00:00:00Z',
    partySize: 4,
    memberCount: 2,
    minCp: 300_000_000,
    note: 'Chill run',
    status: 'open',
    deleted: false,
    isPoster: false,
    members: [poster, member('m2', 'Bob', 'member')],
    isMember: false,
    incomingRequests: [],
    sentInvites: [],
    myPending: [],
    receivedInvites: [],
    sentInvitesToThis: [],
    canRenew: false,
    ...over,
  };
};

const tiers = { '/api/rarity-tiers': [{ id: 1, name: 'Common', minCp: 0, sortOrder: 0 }] };

function renderPage(routes: Record<string, unknown>) {
  const fetchMock = mockApi({ ...tiers, ...routes });
  renderWithProviders(
    <Routes>
      <Route path="/posts/:id" element={<PostDetailPage />} />
      <Route path="/" element={<p>Home page</p>} />
    </Routes>,
    { route: '/posts/p1' },
  );
  return fetchMock;
}

const called = (fetchMock: ReturnType<typeof mockApi>, url: string, method: string) =>
  fetchMock.mock.calls.some(([u, i]) => String(u) === url && (i?.method ?? 'GET') === method);

afterEach(() => vi.restoreAllMocks());

describe('PostDetailPage lineup', () => {
  it('lineup renders poster + member cards and "CP at join" captions; recruiting partySize 4 with 2 members shows 2 Open slot placeholders', async () => {
    const p = post({
      members: [member('m1', 'Lily', 'poster'), member('m2', 'Bob', 'member', { character: character('c-m2', 'Bob', 1_600_000_000) })],
    });
    renderPage({ '/api/posts/p1': p });
    expect(await screen.findByRole('button', { name: /Lily, level 280/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bob, level 280/ })).toBeInTheDocument();
    expect(screen.getAllByText(/CP at join 1\.5B/)).toHaveLength(2);
    expect(screen.getAllByText(/now 1\.6B/)).toHaveLength(1);
    expect(screen.getAllByText('Open slot')).toHaveLength(2);
  });

  it('deleted character member renders snapshot card with its IGN', async () => {
    const gone = member('m2', 'Ghost', 'member', { character: null, characterId: null });
    renderPage({ '/api/posts/p1': post({ members: [member('m1', 'Lily', 'poster'), gone] }) });
    expect(await screen.findByText('Deleted character')).toBeInTheDocument();
    expect(screen.getByText(/Ghost · Lv\. 280 Bishop/)).toBeInTheDocument();
  });

  it('clicking a card opens the detail modal', async () => {
    renderPage({ '/api/posts/p1': post() });
    fireEvent.click(await screen.findByRole('button', { name: /Bob, level 280/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('PostDetailPage poster controls', () => {
  it('poster sees applicants; Accept posts to /api/requests/r1/accept; Decline to /decline', async () => {
    const p = post({ isPoster: true, incomingRequests: [request('r1', 'Zed', 900_000_000), request('r2', 'Amy', 900_000_000)] });
    const fetchMock = renderPage({
      '/api/posts/p1': p,
      'POST /api/requests/r1/accept': p,
      'POST /api/requests/r2/decline': {},
    });
    expect(await screen.findByRole('heading', { name: 'Applicants' })).toBeInTheDocument();
    const applicants = screen.getByRole('region', { name: 'Applicants' });
    fireEvent.click(within(applicants).getAllByRole('button', { name: 'Accept' })[0]);
    await waitFor(() => expect(called(fetchMock, '/api/requests/r1/accept', 'POST')).toBe(true));
    fireEvent.click(within(applicants).getAllByRole('button', { name: 'Decline' })[1]);
    await waitFor(() => expect(called(fetchMock, '/api/requests/r2/decline', 'POST')).toBe(true));
  });

  it('below-min-CP badge shown for applicant with CP 100M on minCp 300M post', async () => {
    renderPage({ '/api/posts/p1': post({ isPoster: true, incomingRequests: [request('r1', 'Low', 100_000_000)] }) });
    expect(await screen.findByText('Below min CP')).toBeInTheDocument();
  });

  it('poster Remove on a member calls DELETE members', async () => {
    const fetchMock = renderPage({
      '/api/posts/p1': post({ isPoster: true }),
      'DELETE /api/posts/p1/members/m2': post({ isPoster: true }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(called(fetchMock, '/api/posts/p1/members/m2', 'DELETE')).toBe(true));
  });

  it('poster sees sent invites with Cancel', async () => {
    const fetchMock = renderPage({
      '/api/posts/p1': post({ type: 'lfp', partySize: null, minCp: null, isPoster: true, sentInvites: [request('i1', 'Inv', 1, 'invite')] }),
      'POST /api/requests/i1/cancel': {},
    });
    expect(await screen.findByRole('heading', { name: 'Invites sent' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(called(fetchMock, '/api/requests/i1/cancel', 'POST')).toBe(true));
  });

  it('poster Delete confirms then DELETEs and navigates to /', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = renderPage({ '/api/posts/p1': post({ isPoster: true }), 'DELETE /api/posts/p1': undefined });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(called(fetchMock, '/api/posts/p1', 'DELETE')).toBe(true);
  });

  it('Delete does nothing when confirm is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = renderPage({ '/api/posts/p1': post({ isPoster: true }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(called(fetchMock, '/api/posts/p1', 'DELETE')).toBe(false);
  });

  it('Renew shown only for flexible posts', async () => {
    renderPage({ '/api/posts/p1': post({ isPoster: true, scheduledAt: null, canRenew: true }) });
    expect(await screen.findByRole('button', { name: 'Renew' })).toBeInTheDocument();
  });

  it('Renew shown on an expired flexible post (effectively closed, still renewable)', async () => {
    renderPage({ '/api/posts/p1': post({ isPoster: true, scheduledAt: null, status: 'closed', canRenew: true }) });
    expect(await screen.findByText('This party has ended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renew' })).toBeInTheDocument();
  });

  it('Renew hidden for scheduled posts', async () => {
    renderPage({ '/api/posts/p1': post({ isPoster: true }) });
    await screen.findByRole('button', { name: 'Close' });
    expect(screen.queryByRole('button', { name: 'Renew' })).toBeNull();
  });

  it('Edit link shown to poster only, hidden on closed posts', async () => {
    renderPage({ '/api/posts/p1': post({ isPoster: true }) });
    expect(await screen.findByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/posts/p1/edit');
  });

  it('Edit link hidden for non-poster', async () => {
    renderPage({ '/api/posts/p1': post() });
    await screen.findByText('Chill run');
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  it('non-poster sees no applicants section', async () => {
    renderPage({ '/api/posts/p1': post({ incomingRequests: [request('r1', 'Zed', 1)] }) });
    await screen.findByText('Chill run');
    expect(screen.queryByRole('heading', { name: 'Applicants' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('closed post shows ended banner and no poster actions except Delete', async () => {
    renderPage({ '/api/posts/p1': post({ isPoster: true, status: 'closed', scheduledAt: null }) });
    expect(await screen.findByText('This party has ended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Renew' })).toBeNull();
  });
});

describe('PostDetailPage errors', () => {
  it('404 shows unavailable message', async () => {
    renderPage({});
    expect(await screen.findByText("This post isn't available.")).toBeInTheDocument();
  });
});

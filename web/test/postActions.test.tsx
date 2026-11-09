import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostDetailDTO, PostSummaryDTO, RequestDTO } from '@pf/shared';
import { PostDetailPage } from '../src/pages/PostDetailPage';
import { mockApi, renderWithProviders } from './setup';

const character = (id: string, ign: string, cp = 1_500_000_000, world = { id: 5, name: 'Kronos' }): CharacterDTO => ({
  id,
  ign,
  world,
  jobName: 'Bishop',
  level: 280,
  imageUrl: `http://img/${ign}.png`,
  combatPower: cp,
  cpUpdatedAt: '2026-11-01T00:00:00Z',
  guild: { id: 'g1', name: 'Maple Guild', iconUrl: null },
  screenshotUrl: null,
  note: '',
  playTimes: [],
  bosses: [],
  owner: { discordUsername: `${ign}#1` },
  isOwner: false,
  syncStatus: 'ok',
  lastSyncedAt: '2026-11-01T00:00:00Z',
});

const member = (
  id: string,
  ign: string,
  role: 'poster' | 'member',
  over: Partial<PartyMemberDTO> = {},
): PartyMemberDTO => ({
  id,
  role,
  characterId: `c-${id}`,
  cpAtJoin: 1_500_000_000,
  joinedAt: '2026-11-09T00:00:00Z',
  character: character(`c-${id}`, ign),
  snapshot: {
    ign,
    jobName: 'Bishop',
    level: 280,
    imageUrl: `http://img/${ign}.png`,
    worldName: 'Kronos',
    guildName: 'Maple Guild',
  },
  isMine: false,
  ...over,
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
    ...over,
  };
};

const me = {
  id: 'u1',
  discordUsername: 'me#1',
  avatarUrl: null,
  isAdmin: false,
};
const scania = { id: 6, name: 'Scania' };
const base = {
  '/api/rarity-tiers': [{ id: 1, name: 'Common', minCp: 0, sortOrder: 0 }],
  '/api/auth/me': me,
  '/api/me/parties': [],
  '/api/me/posts': [],
};
const mine = [character('k1', 'KronosMain'), character('s1', 'ScaniaAlt', 1_500_000_000, scania)];

function renderPage(routes: Record<string, unknown>) {
  const fetchMock = mockApi({ ...base, ...routes });
  renderWithProviders(
    <Routes>
      <Route path="/posts/:id" element={<PostDetailPage />} />
    </Routes>,
    { route: '/posts/p1' },
  );
  return fetchMock;
}

const called = (fetchMock: ReturnType<typeof mockApi>, url: string, method: string) =>
  fetchMock.mock.calls.some(([u, i]) => String(u) === url && (i?.method ?? 'GET') === method);

afterEach(() => vi.restoreAllMocks());

describe('request to join', () => {
  it('Request to join lists only same-world characters and posts {characterId}', async () => {
    const fetchMock = renderPage({
      '/api/posts/p1': post(),
      '/api/characters?mine=1': mine,
      'POST /api/posts/p1/requests': {},
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Request to join' }));
    const pick = await screen.findByRole('button', { name: /KronosMain/ });
    expect(screen.queryByRole('button', { name: /ScaniaAlt/ })).toBeNull();
    fireEvent.click(pick);
    await waitFor(() => expect(called(fetchMock, '/api/posts/p1/requests', 'POST')).toBe(true));
    const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/posts/p1/requests' && i?.method === 'POST')!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ characterId: 'k1' });
  });

  it('pending request shows Cancel which posts /api/requests/:id/cancel', async () => {
    const pending: RequestDTO = {
      id: 'r9',
      kind: 'join_request',
      status: 'pending',
      postId: 'p1',
      lfpPostId: null,
      character: mine[0],
      createdAt: '2026-11-09T00:00:00Z',
      decidedAt: null,
    };
    const fetchMock = renderPage({
      '/api/posts/p1': post({ myPending: [pending] }),
      '/api/characters?mine=1': mine,
      'POST /api/requests/r9/cancel': {},
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(called(fetchMock, '/api/requests/r9/cancel', 'POST')).toBe(true));
  });

  it('below-min-CP warning text for a 100M character on a 300M post', async () => {
    renderPage({
      '/api/posts/p1': post(),
      '/api/characters?mine=1': [character('k1', 'KronosMain', 100_000_000)],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Request to join' }));
    expect(await screen.findByText('Below the minimum CP — you can still apply')).toBeInTheDocument();
  });

  it('overlap warning when my character is in a party 2h apart', async () => {
    const other = post({
      id: 'p2',
      scheduledAt: '2026-12-01T22:00:00Z',
      members: [member('x1', 'Other', 'poster'), member('x2', 'KronosMain', 'member', { characterId: 'k1' })],
    });
    renderPage({
      '/api/posts/p1': post(),
      '/api/characters?mine=1': mine,
      '/api/me/parties': [other],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Request to join' }));
    expect(await screen.findByText('Already in a party around this time')).toBeInTheDocument();
  });

  it('no same-world characters → "None of your characters are on Kronos."', async () => {
    renderPage({
      '/api/posts/p1': post(),
      '/api/characters?mine=1': [mine[1]],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Request to join' }));
    expect(await screen.findByText('None of your characters are on Kronos.')).toBeInTheDocument();
  });

  it('ALREADY_PENDING error shows friendly text', async () => {
    renderPage({
      '/api/posts/p1': post(),
      '/api/characters?mine=1': mine,
    });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/posts/p1/requests' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            error: { code: 'ALREADY_PENDING', message: 'dup' },
          }),
          { status: 409 },
        );
      }
      return real(input, init);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Request to join' }));
    fireEvent.click(await screen.findByRole('button', { name: /KronosMain/ }));
    expect(await screen.findByText('There is already a pending request for that character.')).toBeInTheDocument();
  });

  it('visitor sees log in prompt', async () => {
    renderPage({ '/api/posts/p1': post(), '/api/auth/me': null });
    expect(await screen.findByText('Log in with Discord to join.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request to join' })).toBeNull();
  });
});

describe('invite', () => {
  const lfp = () =>
    post({
      type: 'lfp',
      partySize: null,
      minCp: null,
      memberCount: 1,
      members: [member('m1', 'Lily', 'poster')],
    });
  const summary = (id: string, over: Partial<PostSummaryDTO> = {}): PostSummaryDTO => ({
    ...post(),
    id,
    isPoster: true,
    ...over,
  });

  it('LFP post Invite lists my open recruiting posts on same world and posts {recruitingPostId}', async () => {
    const fetchMock = renderPage({
      '/api/posts/p1': lfp(),
      '/api/me/posts': [
        summary('mine1'),
        summary('other-world', { world: scania }),
        summary('lfp-post', { type: 'lfp' }),
        summary('closed-one', { status: 'closed' }),
      ],
      'POST /api/posts/p1/invites': {},
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Invite' }));
    const list = await screen.findByRole('list', {
      name: 'Your open recruiting posts',
    });
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(within(list).getByRole('button'));
    await waitFor(() => expect(called(fetchMock, '/api/posts/p1/invites', 'POST')).toBe(true));
    const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/posts/p1/invites' && i?.method === 'POST')!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      recruitingPostId: 'mine1',
    });
  });

  it('shows an empty state when I have no open recruiting posts', async () => {
    renderPage({ '/api/posts/p1': lfp() });
    fireEvent.click(await screen.findByRole('button', { name: 'Invite' }));
    expect(await screen.findByText(/no open recruiting posts/i)).toBeInTheDocument();
  });
});

describe('leave', () => {
  it('member Leave confirms and DELETEs /api/posts/:id/members/:memberId', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const p = post({
      isMember: true,
      members: [member('m1', 'Lily', 'poster'), member('m2', 'Bob', 'member', { isMine: true })],
    });
    const fetchMock = renderPage({
      '/api/posts/p1': p,
      'DELETE /api/posts/p1/members/m2': p,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    expect(window.confirm).toHaveBeenCalledWith('Leave this party?');
    await waitFor(() => expect(called(fetchMock, '/api/posts/p1/members/m2', 'DELETE')).toBe(true));
  });
});

describe('carried fixes', () => {
  it('closed post hides Open slot placeholders', async () => {
    renderPage({ '/api/posts/p1': post({ status: 'closed' }) });
    await screen.findByText('This party has ended');
    expect(screen.queryByText('Open slot')).toBeNull();
  });

  it('deleted post hides Open slot placeholders', async () => {
    renderPage({ '/api/posts/p1': post({ deleted: true }) });
    await screen.findByText('Deleted');
    expect(screen.queryByText('Open slot')).toBeNull();
  });

  it('Accept is disabled while its mutation is pending', async () => {
    const p = post({
      isPoster: true,
      incomingRequests: [
        {
          id: 'r1',
          kind: 'join_request',
          status: 'pending',
          postId: 'p1',
          lfpPostId: null,
          character: character('rc', 'Zed'),
          createdAt: '2026-11-09T00:00:00Z',
          decidedAt: null,
        },
      ],
    });
    renderPage({ '/api/posts/p1': p });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/requests/r1/accept' ? new Promise<Response>(() => {}) : real(input, init),
    );
    const btn = await screen.findByRole('button', { name: 'Accept' });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
  });
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostDetailDTO, PostSummaryDTO, RequestDTO, RequestWithPostDTO } from '@pf/shared';
import { PostDetailPage } from '../src/pages/PostDetailPage';
import { mockApi, renderWithProviders } from './setup';

const character = (id: string, ign: string, cp = 1_500_000_000, world = { id: 5, name: 'Kronos' }): CharacterDTO => ({
  id,
  ign,
  world,
  jobName: 'Bishop', archetype: 'magician',
  level: 280,
  imageUrl: `http://img/${ign}.png`,
  combatPower: cp,
  cpUpdatedAt: '2026-11-01T00:00:00Z',
  guild: { id: 'g1', name: 'Maple Guild', iconUrl: null }, manual: false,
  screenshotUrl: null,
  owner: { discordUsername: `${ign}#1`, displayName: null, discordLinked: true },
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
  freeTimes: [], freeTimesZone: null, isMine: false,
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
    freeTimes: [],
    weeklyTimeZone: null, freeTimesZone: null,
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

const me = {
  id: 'u1',
  discordUsername: 'me#1',
  avatarUrl: null,
  isAdmin: false,
};
const scania = { id: 6, name: 'Scania' };
const base = {
  '/api/discord-destinations': [],
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
    expect(await screen.findByText('Log in to join.')).toBeInTheDocument();
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

  it.each(['recruiting', 'carrying'] as const)('LFP post Invite offers my open %s parties on the same world', async (type) => {
    const fetchMock = renderPage({
      '/api/posts/p1': lfp(),
      '/api/me/posts': [
        summary('mine1', { type }),
        summary('other-world', { world: scania }),
        summary('lfp-post', { type: 'lfp' }),
        summary('closed-one', { status: 'closed' }),
      ],
      'POST /api/posts/p1/invites': {},
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Invite' }));
    const list = await screen.findByRole('list', {
      name: 'Your open parties',
    });
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(within(list).getByRole('button'));
    await waitFor(() => expect(called(fetchMock, '/api/posts/p1/invites', 'POST')).toBe(true));
    const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/posts/p1/invites' && i?.method === 'POST')!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      recruitingPostId: 'mine1',
    });
  });

  it('shows an empty state when I have no open parties', async () => {
    renderPage({ '/api/posts/p1': lfp() });
    fireEvent.click(await screen.findByRole('button', { name: 'Invite' }));
    expect(await screen.findByText(/no open parties/i)).toBeInTheDocument();
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

describe('stale error clearing', () => {
  const req = (id: string, ign: string, kind: RequestDTO['kind'] = 'join_request'): RequestDTO => ({
    id,
    kind,
    status: 'pending',
    postId: 'p1',
    lfpPostId: null,
    character: character(`rc-${id}`, ign),
    createdAt: '2026-11-09T00:00:00Z',
    decidedAt: null,
  });
  const failPost = (url: string, code: string) => {
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === url && init?.method === 'POST'
        ? new Response(JSON.stringify({ error: { code, message: 'x' } }), { status: 409 })
        : real(input, init),
    );
  };

  it('poster: a failed Decline error disappears after a later Accept succeeds', async () => {
    const p = post({ isPoster: true, incomingRequests: [req('r1', 'Zed'), req('r2', 'Amy')] });
    renderPage({ '/api/posts/p1': p, 'POST /api/requests/r2/accept': p });
    failPost('/api/requests/r1/decline', 'NOT_PENDING');
    const applicants = await screen.findByRole('region', { name: 'Applicants' });
    fireEvent.click(within(applicants).getAllByRole('button', { name: 'Decline' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('That request has already been handled.');
    fireEvent.click(within(applicants).getAllByRole('button', { name: 'Accept' })[1]);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('viewer: a failed Request error disappears after a later Cancel succeeds', async () => {
    renderPage({
      '/api/posts/p1': post({ myPending: [req('r9', 'Other')] }),
      '/api/characters?mine=1': mine,
      'POST /api/requests/r9/cancel': {},
    });
    failPost('/api/posts/p1/requests', 'ALREADY_PENDING');
    fireEvent.click(await screen.findByRole('button', { name: 'Request to join' }));
    fireEvent.click(await screen.findByRole('button', { name: /KronosMain/ }));
    expect(await screen.findByText('There is already a pending request for that character.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('invites on the post page', () => {
  const invite = (id: string, over: Partial<RequestDTO> = {}): RequestDTO => ({
    id,
    kind: 'invite',
    status: 'pending',
    postId: 'p1',
    lfpPostId: 'lfp1',
    character: { ...mine[0]!, isOwner: true },
    createdAt: '2026-11-09T00:00:00Z',
    decidedAt: null,
    ...over,
  });
  const withPost = (r: RequestDTO, postId: string): RequestWithPostDTO => ({
    ...r,
    postId,
    post: { ...post(), id: postId, bosses: [{ bossDifficultyId: 9, bossName: 'Will', difficulty: 'Hard' }] },
  });
  const lfpPost = (over: Partial<PostDetailDTO> = {}) =>
    post({ type: 'lfp', partySize: null, minCp: null, memberCount: 1, members: [member('m1', 'Lily', 'poster')], ...over });

  it('invitee on the recruiting post sees Accept/Decline, not Cancel', async () => {
    const fetchMock = renderPage({
      '/api/posts/p1': post({ myPending: [invite('r5')] }),
      'POST /api/requests/r5/accept': post(),
      'POST /api/requests/r5/decline': {},
    });
    const actions = await screen.findByRole('region', { name: 'Your actions' });
    await within(actions).findByText(/Invite pending: KronosMain/);
    expect(within(actions).queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(within(actions).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(called(fetchMock, '/api/requests/r5/decline', 'POST')).toBe(true));
    fireEvent.click(within(actions).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(called(fetchMock, '/api/requests/r5/accept', 'POST')).toBe(true));
  });

  it('LFP poster sees received invites linking to the recruiting post; Accept opens it, Decline declines', async () => {
    const fetchMock = renderPage({
      '/api/posts/p1': lfpPost({ isPoster: true, receivedInvites: [withPost(invite('r6'), 'p9')] }),
      'POST /api/requests/r6/accept': post({ id: 'p9' }),
      'POST /api/requests/r6/decline': {},
      '/api/posts/p9': post({ id: 'p9', note: 'Recruiting page' }),
    });
    const region = await screen.findByRole('region', { name: 'Invites received' });
    expect(within(region).getByRole('link', { name: /Hard Will/ })).toHaveAttribute('href', '/posts/p9');
    fireEvent.click(within(region).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(called(fetchMock, '/api/requests/r6/decline', 'POST')).toBe(true));
    fireEvent.click(within(region).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(called(fetchMock, '/api/requests/r6/accept', 'POST')).toBe(true));
    expect(await screen.findByText('Recruiting page')).toBeInTheDocument();
  });

  it('recruiter sees "Invite sent from" with Cancel, and that post is not offered again', async () => {
    const fetchMock = renderPage({
      '/api/posts/p1': lfpPost({ sentInvitesToThis: [withPost(invite('r7', { postId: 'mine1' }), 'mine1')] }),
      '/api/me/posts': [
        { ...post(), id: 'mine1', isPoster: true },
        { ...post(), id: 'mine2', isPoster: true, bosses: [{ bossDifficultyId: 8, bossName: 'Gloom', difficulty: 'Chaos' }] },
      ],
      'POST /api/requests/r7/cancel': {},
    });
    const actions = await screen.findByRole('region', { name: 'Your actions' });
    expect(await within(actions).findByText(/Invite sent from Hard Will/)).toBeInTheDocument();
    fireEvent.click(within(actions).getByRole('button', { name: 'Invite' }));
    const list = await screen.findByRole('list', { name: 'Your open parties' });
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    expect(within(list).getByRole('button')).toHaveTextContent('Chaos Gloom');
    fireEvent.click(within(actions).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(called(fetchMock, '/api/requests/r7/cancel', 'POST')).toBe(true));
  });
});

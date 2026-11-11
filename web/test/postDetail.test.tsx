import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostDetailDTO, RequestDTO } from '@pf/shared';
import { PostDetailPage } from '../src/pages/PostDetailPage';
import { mockApi, renderWithProviders, testQueryClient } from './setup';

const character = (id: string, ign: string, cp = 1_500_000_000): CharacterDTO => ({
  id,
  ign,
  world: { id: 5, name: 'Kronos' },
  jobName: 'Bishop', archetype: 'magician',
  level: 280,
  imageUrl: `http://img/${ign}.png`,
  combatPower: cp,
  cpUpdatedAt: '2026-11-01T00:00:00Z',
  guild: { id: 'g1', name: 'Maple Guild', iconUrl: null }, manual: false,
  screenshotUrl: null,
  owner: { discordUsername: `${ign}#1`, displayName: null },
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
  freeTimes: [], freeTimesZone: null, isMine: false,
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
  it('disables Discord announcements until the cooldown expires', async () => {
    const availableAt = new Date(Date.now() + 60_000).toISOString();
    renderPage({ '/api/posts/p1': post({ isPoster: true, discordAnnouncementAvailableAt: availableAt }) });
    expect(await screen.findByRole('button', { name: 'Notify Discord' })).toBeDisabled();
    expect(screen.getByText(/^Available /)).toBeInTheDocument();
  });

  it('allows the owner to queue a Discord announcement when eligible', async () => {
    const p = post({ isPoster: true, discordAnnouncementAvailableAt: new Date(Date.now() - 60_000).toISOString() });
    const fetchMock = renderPage({ '/api/posts/p1': p, 'POST /api/posts/p1/discord-announcement': { ...p, discordAnnouncementAvailableAt: new Date(Date.now() + 86_400_000).toISOString() } });
    fireEvent.click(await screen.findByRole('button', { name: 'Notify Discord' }));
    await waitFor(() => expect(called(fetchMock, '/api/posts/p1/discord-announcement', 'POST')).toBe(true));
    expect(await screen.findByText('Discord notification queued.')).toBeInTheDocument();
  });

  it('does not offer Discord announcements to other viewers', async () => {
    renderPage({ '/api/posts/p1': post({ isPoster: false, discordAnnouncementAvailableAt: new Date(Date.now() - 1000).toISOString() }) });
    await screen.findByText('Chill run');
    expect(screen.queryByRole('button', { name: 'Notify Discord' })).toBeNull();
  });
  it('keeps a finalized party manageable while showing recruitment is closed', async () => {
    const p = post({ isPoster: true, isMember: true, status: 'closed', recruitmentClosed: true });
    renderPage({ '/api/posts/p1': p, '/api/auth/me': { id: 'u1' } });
    expect(await screen.findByText('Recruitment closed')).toBeInTheDocument();
    expect(screen.getByText('Recruitment is closed. Your party is scheduled.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change time' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByText('Applicants')).not.toBeInTheDocument();
  });
  it('keeps an in-progress availability edit when a background refresh fails', async () => {
    const p = post({ members: [member('m1', 'Lily', 'poster'), member('m2', 'Bob', 'member', { isMine: true })], isMember: true });
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === '/api/posts/p1') return fail
        ? new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Unavailable' } }), { status: 500 })
        : new Response(JSON.stringify(p), { status: 200 });
      if (String(url) === '/api/rarity-tiers') return new Response('[]', { status: 200 });
      return new Response(null, { status: 404 });
    }));
    const client = testQueryClient();
    renderWithProviders(<Routes><Route path="/posts/:id" element={<PostDetailPage />} /></Routes>, { route: '/posts/p1', client });
    fireEvent.click(await screen.findByRole('button', { name: /Edit availability for Bob/ }));
    fireEvent.click(screen.getByRole('button', { name: /Tue 8:30p/ }));
    fail = true;
    await act(async () => { await client.invalidateQueries({ queryKey: ['posts', 'detail', 'p1'] }); });
    expect(await screen.findByText(/Couldn't refresh this post/)).toBeVisible();
    expect(screen.getByRole('button', { name: /Tue 8:30p/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Save availability' })).toBeVisible();
  });

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
    const expiry = await screen.findByRole('region', { name: 'Post expiry' });
    expect(within(expiry).getByText('Automatically closes', { exact: false })).toBeInTheDocument();
    expect(expiry.querySelector('time')).toHaveAttribute('datetime', '2026-12-02T00:00:00Z');
    expect(within(expiry).getByRole('button', { name: 'Renew for 7 days' })).toBeInTheDocument();
  });

  it('refreshes the expiry displayed after the poster renews', async () => {
    let p = post({ isPoster: true, scheduledAt: null, canRenew: true });
    const fetchMock = renderPage({
      '/api/posts/p1': () => p,
      'POST /api/posts/p1/renew': () => { p = { ...p, expiresAt: '2026-12-09T00:00:00Z' }; return p; },
    });
    const expiry = await screen.findByRole('region', { name: 'Post expiry' });
    fireEvent.click(within(expiry).getByRole('button', { name: 'Renew for 7 days' }));
    await waitFor(() => expect(called(fetchMock, '/api/posts/p1/renew', 'POST')).toBe(true));
    await waitFor(() => expect(expiry.querySelector('time')).toHaveAttribute('datetime', '2026-12-09T00:00:00Z'));
  });

  it('shows expiry to other viewers without a renewal button', async () => {
    renderPage({ '/api/posts/p1': post({ isPoster: false, scheduledAt: null, canRenew: false }) });
    const expiry = await screen.findByRole('region', { name: 'Post expiry' });
    expect(expiry.querySelector('time')).toHaveAttribute('datetime', '2026-12-02T00:00:00Z');
    expect(within(expiry).queryByRole('button', { name: 'Renew for 7 days' })).toBeNull();
  });

  it('Reopen is shown on an expired flexible post', async () => {
    renderPage({ '/api/posts/p1': post({ isPoster: true, scheduledAt: null, status: 'closed', canRenew: true }) });
    expect(await screen.findByText('This party has ended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Renew for 7 days' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Post expiry' })).toBeNull();
  });

  it('Renew hidden for scheduled posts', async () => {
    renderPage({ '/api/posts/p1': post({ isPoster: true }) });
    await screen.findByRole('button', { name: 'Close' });
    expect(screen.queryByRole('button', { name: 'Renew for 7 days' })).toBeNull();
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

  it('closed post shows Reopen and explains what will happen', async () => {
    renderPage({ '/api/posts/p1': post({ isPoster: true, status: 'closed', scheduledAt: null }) });
    expect(await screen.findByText('This party has ended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.getByText(/clears the final time and weekly reminders/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Renew for 7 days' })).toBeNull();
  });

  it('reopens a closed post when the owner selects Reopen', async () => {
    const p = post({ isPoster: true, status: 'closed', scheduledAt: null });
    const fetchMock = renderPage({ '/api/posts/p1': p, 'POST /api/posts/p1/reopen': { ...p, status: 'open' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(called(fetchMock, '/api/posts/p1/reopen', 'POST')).toBe(true));
  });
});

describe('PostDetailPage errors', () => {
  it('404 shows unavailable message', async () => {
    renderPage({});
    expect(await screen.findByText("This post isn't available.")).toBeInTheDocument();
  });
});

describe('PostDetailPage when section', () => {
  it('finalized post shows "Final time: ..."', async () => {
    renderPage({ '/api/posts/p1': post({ scheduledAt: '2026-12-01T20:00:00Z' }) });
    expect(await screen.findByText(/Final time: /)).toBeInTheDocument();
  });

  it('shows the time once: the header carries world and guild, not the time', async () => {
    renderPage({ '/api/posts/p1': post({ scheduledAt: '2026-12-01T20:00:00Z' }) });
    await screen.findByText(/Final time: /);
    const head = document.querySelector('.post-detail__head')!;
    expect(head).toHaveTextContent(/Kronos · /);
    expect(head).not.toHaveTextContent(/Dec/);
    expect(screen.getAllByText(/Final time: /)).toHaveLength(1);
  });

  it('an LFP post never shows a final time, even with a stale scheduledAt', async () => {
    renderPage({
      '/api/posts/p1': post({ type: 'lfp', partySize: null, minCp: null, scheduledAt: '2026-12-01T20:00:00Z', freeTimes: [30], freeTimesZone: 'UTC' }),
    });
    expect(await screen.findByRole('region', { name: 'When' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'When' })).queryByText(/Final time/)).toBeNull();
  });

  it('unfinalized post with free times shows "Time not set yet", the read-only grid and the zone caption', async () => {
    renderPage({ '/api/posts/p1': post({ scheduledAt: null, freeTimes: [30, 31], freeTimesZone: 'UTC' }) });
    expect(await screen.findByText('Time not set yet')).toBeInTheDocument();
    expect(screen.getByText(/^Shown in your time zone \(/)).toBeInTheDocument();
    expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'true');
  });

  it('old post with no free times and a null zone shows "Flexible" and no grid', async () => {
    renderPage({ '/api/posts/p1': post({ scheduledAt: null, freeTimes: [], freeTimesZone: null }) });
    expect(await screen.findByText('Time not set yet')).toBeInTheDocument();
    expect(screen.getAllByText('Flexible').length).toBeGreaterThan(0);
    expect(screen.queryByRole('grid')).toBeNull();
  });
});

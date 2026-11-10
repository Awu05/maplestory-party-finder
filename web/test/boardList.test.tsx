import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostSummaryDTO } from '@pf/shared';
import { App } from '../src/App';
import { mockApi, renderWithProviders, setViewport } from './setup';

const character: CharacterDTO = {
  id: 'c1',
  ign: 'Lily',
  world: { id: 5, name: 'Kronos' },
  jobName: 'Bishop',
  level: 280,
  imageUrl: 'http://img/lily.png',
  combatPower: 1_500_000_000,
  cpUpdatedAt: '2026-11-01T00:00:00Z',
  guild: { id: 'g1', name: 'Maple Guild', iconUrl: null },
  screenshotUrl: null,
  note: '',
  playTimes: [],
  bosses: [],
  owner: { discordUsername: 'lily#1' },
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

const p1: PostSummaryDTO = {
  id: 'p1',
  type: 'recruiting',
  world: { id: 5, name: 'Kronos' },
  guild: { id: 'g1', name: 'Maple Guild' },
  poster,
  bosses: [{ bossDifficultyId: 7, bossName: 'Lucid', difficulty: 'Hard' }],
  scheduledAt: null,
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

const p2: PostSummaryDTO = {
  ...p1,
  id: 'p2',
  type: 'lfp',
  bosses: [{ bossDifficultyId: 8, bossName: 'Will', difficulty: 'Normal' }],
  partySize: null,
  memberCount: 1,
};

const detailExtras = {
  isMember: false,
  incomingRequests: [],
  sentInvites: [],
  myPending: [],
  receivedInvites: [],
  sentInvitesToThis: [],
  canRenew: false,
};

const base = {
  '/api/auth/me': null,
  '/api/worlds': [{ id: 5, nexonWorldId: 5, name: 'Kronos', worldType: 'normal', active: true }],
  '/api/guilds': [{ id: 'g1', name: 'Maple Guild' }],
  '/api/bosses': [
    { id: 1, name: 'Lucid', difficulties: [{ id: 7, difficulty: 'Hard', partyCap: 6 }] },
    { id: 2, name: 'Will', difficulties: [{ id: 8, difficulty: 'Normal', partyCap: 6 }] },
  ],
  '/api/rarity-tiers': [{ id: 1, name: 'Common', minCp: 0, sortOrder: 0 }],
  '/api/posts/p1': { ...detailExtras, ...p1, members: [poster] },
  '/api/posts/p2': { ...detailExtras, ...p2, members: [poster] },
};

function Where() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.pathname + loc.search}</output>;
}

const loc = () => screen.getByTestId('loc').textContent;

function renderBoard(route = '/') {
  return renderWithProviders(
    <>
      <App />
      <Where />
    </>,
    { route },
  );
}

/** Makes requests to `url` wait until the returned release() is called (mockApi itself answers synchronously). */
function holdRequest(fetchMock: ReturnType<typeof mockApi>, url: string) {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const real = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input, init) =>
    String(input) === url ? gate.then(() => real(input, init)) : real(input, init),
  );
  return () => release();
}

const postsCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/posts?') || u === '/api/posts');

describe('Board list', () => {
  it('selects the first post by default and writes ?post=p1', async () => {
    mockApi({ ...base, '/api/posts': [p1, p2] });
    renderBoard();
    const list = await screen.findByRole('listbox', { name: 'Posts' });
    const rows = await within(list).findAllByRole('option');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    expect(rows[1]).toHaveAttribute('aria-selected', 'false');
    expect(rows[0]).toHaveAttribute('tabindex', '0');
    expect(rows[1]).toHaveAttribute('tabindex', '-1');
    expect(rows[0]).toHaveAttribute('href', '/posts/p1');
    await waitFor(() => expect(loc()).toBe('/?post=p1'));
    expect(screen.getByRole('region', { name: 'Post preview' })).toBeInTheDocument();
  });

  it('clicking row 2 selects it and updates the URL without navigating', async () => {
    mockApi({ ...base, '/api/posts': [p1, p2] });
    renderBoard();
    const rows = await within(await screen.findByRole('listbox', { name: 'Posts' })).findAllByRole('option');
    fireEvent.click(rows[1]);
    await waitFor(() => expect(loc()).toBe('/?post=p2'));
    const after = within(screen.getByRole('listbox', { name: 'Posts' })).getAllByRole('option');
    expect(after[1]).toHaveAttribute('aria-selected', 'true');
    expect(after[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('a modifier click falls through (no selection change)', async () => {
    mockApi({ ...base, '/api/posts': [p1, p2] });
    renderBoard();
    const rows = await within(await screen.findByRole('listbox', { name: 'Posts' })).findAllByRole('option');
    await waitFor(() => expect(loc()).toBe('/?post=p1'));
    // true = not default-prevented, so the browser opens the link in a new tab.
    expect(fireEvent.click(rows[1], { ctrlKey: true })).toBe(true);
    expect(rows[1]).toHaveAttribute('aria-selected', 'false');
    expect(loc()).toBe('/?post=p1');
  });

  it('a stale ?post=missing selects p1 and rewrites the URL', async () => {
    mockApi({ ...base, '/api/posts': [p1, p2] });
    renderBoard('/?post=missing');
    const rows = await within(await screen.findByRole('listbox', { name: 'Posts' })).findAllByRole('option');
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(loc()).toBe('/?post=p1'));
  });

  it('a stale id is rewritten without dropping other params', async () => {
    mockApi({ ...base, '/api/posts': [p1, p2] });
    renderBoard('/?x=1&post=missing');
    await screen.findByRole('listbox', { name: 'Posts' });
    await waitFor(() => expect(loc()).toBe('/?x=1&post=p1'));
  });

  it('keeps an existing ?post= selection and other params', async () => {
    mockApi({ ...base, '/api/posts': [p1, p2] });
    renderBoard('/?x=1&post=p2');
    const rows = await within(await screen.findByRole('listbox', { name: 'Posts' })).findAllByRole('option');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    expect(loc()).toBe('/?x=1&post=p2');
  });

  it('ArrowDown moves the selection and focus; Enter opens /posts/p2', async () => {
    mockApi({ ...base, '/api/posts': [p1, p2] });
    renderBoard();
    const rows = await within(await screen.findByRole('listbox', { name: 'Posts' })).findAllByRole('option');
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    await waitFor(() => expect(loc()).toBe('/?post=p2'));
    expect(rows[1]).toHaveFocus();
    expect(rows[1]).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(rows[1], { key: 'ArrowUp' });
    await waitFor(() => expect(loc()).toBe('/?post=p1'));
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    await waitFor(() => expect(loc()).toBe('/?post=p2'));
    fireEvent.keyDown(rows[1], { key: 'Enter' });
    await waitFor(() => expect(loc()).toBe('/posts/p2'));
  });

  it('Home/End jump to the ends and arrows clamp there', async () => {
    const p3 = { ...p2, id: 'p3' };
    mockApi({ ...base, '/api/posts': [p1, p2, p3] });
    renderBoard();
    const rows = await within(await screen.findByRole('listbox', { name: 'Posts' })).findAllByRole('option');
    await waitFor(() => expect(loc()).toBe('/?post=p1'));
    fireEvent.keyDown(rows[0], { key: 'ArrowUp' });
    expect(loc()).toBe('/?post=p1');
    fireEvent.keyDown(rows[0], { key: 'End' });
    await waitFor(() => expect(loc()).toBe('/?post=p3'));
    expect(rows[2]).toHaveFocus();
    fireEvent.keyDown(rows[2], { key: 'ArrowDown' });
    expect(loc()).toBe('/?post=p3');
    fireEvent.keyDown(rows[2], { key: 'Home' });
    await waitFor(() => expect(loc()).toBe('/?post=p1'));
    expect(rows[0]).toHaveFocus();
  });

  it('Ctrl+Enter is left to the native link', async () => {
    mockApi({ ...base, '/api/posts': [p1, p2] });
    renderBoard();
    const rows = await within(await screen.findByRole('listbox', { name: 'Posts' })).findAllByRole('option');
    await waitFor(() => expect(loc()).toBe('/?post=p1'));
    expect(fireEvent.keyDown(rows[0], { key: 'Enter', ctrlKey: true })).toBe(true);
    expect(loc()).toBe('/?post=p1');
  });

  it('describes the listbox with an Enter hint', async () => {
    mockApi({ ...base, '/api/posts': [p1] });
    renderBoard();
    expect(await screen.findByRole('listbox', { name: 'Posts' })).toHaveAccessibleDescription('Press Enter to open the post');
  });

  it('keeps rows (no skeletons) while a filter change refetches', async () => {
    const release = holdRequest(mockApi({ ...base, '/api/posts': [p1, p2], '/api/posts?type=lfp': [p2] }), '/api/posts?type=lfp');
    renderBoard();
    await within(await screen.findByRole('listbox', { name: 'Posts' })).findAllByRole('option');
    fireEvent.click(screen.getByRole('radio', { name: 'LFP' }));
    const list = screen.getByRole('listbox', { name: 'Posts' });
    expect(list).toHaveAttribute('aria-busy', 'true'); // refetch indicator, rows kept
    expect(within(list).getAllByRole('option')).toHaveLength(2);
    release();
    await waitFor(() => expect(within(screen.getByRole('listbox', { name: 'Posts' })).getAllByRole('option')).toHaveLength(1));
  });

  it('hides the preview placeholder when the board fails to load', async () => {
    mockApi(base); // no /api/posts mock: the request fails with 404
    renderBoard();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Post preview' })).not.toBeInTheDocument();
  });

  it('on a phone (375px) a row tap opens the post and there is no preview', async () => {
    setViewport(375);
    mockApi({ ...base, '/api/posts': [p1, p2] });
    renderBoard();
    const row = await screen.findByRole('link', { name: /Hard Lucid/ });
    expect(screen.queryByRole('region', { name: 'Post preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Posts' })).not.toBeInTheDocument();
    expect(loc()).toBe('/');
    fireEvent.click(row);
    await waitFor(() => expect(loc()).toBe('/posts/p1'));
  });

  it('desktop width (1280px) still shows the preview', async () => {
    setViewport(1280);
    mockApi({ ...base, '/api/posts': [p1] });
    renderBoard();
    expect(await screen.findByRole('region', { name: 'Post preview' })).toBeInTheDocument();
  });

  it('shows the empty state and the quiet preview placeholder', async () => {
    mockApi({ ...base, '/api/posts': [] });
    renderBoard();
    expect(await screen.findByText('No open posts match. Be the first to post!')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Post preview' })).toHaveTextContent('Pick a post to see its party');
  });

  it('shows skeleton rows while loading', async () => {
    holdRequest(mockApi({ ...base, '/api/posts': [p1] }), '/api/posts');
    renderBoard();
    const list = await screen.findByRole('listbox', { name: 'Posts' });
    expect(list).toHaveAttribute('aria-busy', 'true');
    expect(list.querySelectorAll('.post-row--skeleton')).toHaveLength(3);
  });

  it('a recruiting row shows 2 / 4 and the poster IGN and guild', async () => {
    mockApi({ ...base, '/api/posts': [p1, p2] });
    renderBoard();
    const rows = await within(await screen.findByRole('listbox', { name: 'Posts' })).findAllByRole('option');
    expect(within(rows[0]).getByText('2 / 4')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Lily · Maple Guild')).toBeInTheDocument();
    expect(within(rows[1]).queryByText(/ \/ /)).not.toBeInTheDocument();
  });
});

describe('Board filters (menus)', () => {
  it('changing the boss resets Difficulty', async () => {
    const fetchMock = mockApi({ ...base, '/api/posts': [] });
    renderBoard();
    await screen.findByText('No open posts match. Be the first to post!');
    fireEvent.click(screen.getByRole('button', { name: /^Boss/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lucid' }));
    fireEvent.click(screen.getByRole('button', { name: /^Difficulty/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Hard' }));
    expect(screen.getByRole('button', { name: /Difficulty: Hard/ })).toBeInTheDocument();
    await waitFor(() => expect(postsCalls(fetchMock)).toContain('/api/posts?bossId=1&bossDifficultyId=7'));
    fireEvent.click(screen.getByRole('button', { name: /^Boss/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Will' }));
    expect(screen.getByRole('button', { name: /^Difficulty/ })).not.toHaveTextContent(':');
    await waitFor(() => expect(postsCalls(fetchMock)).toContain('/api/posts?bossId=2'));
  });

  it('the guild menu sends guildId', async () => {
    const fetchMock = mockApi({ ...base, '/api/posts': [] });
    renderBoard();
    await screen.findByText('No open posts match. Be the first to post!');
    fireEvent.click(screen.getByRole('button', { name: /^Guild/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Maple Guild' }));
    await waitFor(() => expect(postsCalls(fetchMock)).toContain('/api/posts?guildId=g1'));
  });

  it('wraps each filter label with its chips in a group', async () => {
    mockApi({ ...base, '/api/posts': [] });
    renderBoard();
    const type = await screen.findByRole('radiogroup', { name: 'Type' });
    expect(type.closest('.board-filters__group')).toHaveTextContent(/^Type/);
    const worlds = screen.getByRole('group', { name: 'Worlds' });
    expect(worlds.closest('.board-filters__group')).toHaveTextContent(/^Worlds/);
  });
});

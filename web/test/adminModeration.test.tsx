import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { PostsAdmin } from '../src/pages/admin/PostsAdmin';
import { UsersAdmin } from '../src/pages/admin/UsersAdmin';
import { mockApi, renderWithProviders } from './setup';

const user = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, discordUsername: name, avatarUrl: null, banned: false, isAdmin: false,
  createdAt: '2026-01-01T00:00:00Z', characterCount: 1, discordLinked: true, ...over,
});

const char = {
  id: 'c1', ign: 'Mapler', level: 250, jobName: 'Bishop', combatPower: 1_000_000, imageUrl: '',
  world: { id: 1, name: 'Scania' }, guild: { id: 'g', name: 'Alpha', iconUrl: null }, cpUpdatedAt: '2026-01-01T00:00:00Z',
  screenshotUrl: null, owner: { discordUsername: 'bob', displayName: null, discordLinked: true },
};

const usersRoutes = (extra: Record<string, unknown> = {}) => ({
  '/api/admin/users': [user('u1', 'bob'), user('u2', 'root', { isAdmin: true }), user('u3', 'bobby', { banned: true })],
  '/api/rarity-tiers': [],
  ...extra,
});

const bodyOf = (call: unknown[]) => JSON.parse((call[0] as RequestInit).body as string);

afterEach(() => vi.restoreAllMocks());

describe('admin users', () => {
  it('search users debounced → GET /api/admin/users?q=bo', async () => {
    const fetchMock = mockApi({ '/api/admin/users': [], '/api/admin/users?q=bo': [user('u1', 'bob')] });
    renderWithProviders(<UsersAdmin />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search users' }), { target: { value: 'bo' } });
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/admin/users?q=bo')).toBe(false);
    expect(await screen.findByText('bob', undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/admin/users?q=bo')).toBe(true);
  });

  it('Ban confirms then PATCHes {banned:true}', async () => {
    const patch = vi.fn(() => user('u1', 'bob', { banned: true }));
    mockApi(usersRoutes({ 'PATCH /api/admin/users/u1': patch }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<UsersAdmin />);
    const btn = await screen.findByRole('button', { name: 'Ban bob' });
    fireEvent.click(btn);
    expect(confirm).toHaveBeenCalledWith('Ban bob? Their open posts will close.');
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(btn);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(bodyOf(patch.mock.calls[0] as unknown[])).toEqual({ banned: true });
  });

  it('marks typed (password/passkey) Discord names as unverified, without an @', async () => {
    mockApi({ ...usersRoutes(), '/api/admin/users': [user('u1', 'typed_name', { displayName: 'Typed', discordLinked: false }), user('u2', 'real', { displayName: 'Real', discordLinked: true })] });
    renderWithProviders(<UsersAdmin />);
    expect(await screen.findByText('typed_name')).toBeInTheDocument();
    expect(screen.queryByText('@typed_name')).toBeNull();
    expect(screen.getByText('@real')).toBeInTheDocument();
    expect(screen.getAllByText('unverified')).toHaveLength(1);
  });

  it('shows "Discord name not set" for an unlinked account whose typed name was cleared', async () => {
    mockApi({ ...usersRoutes(), '/api/admin/users': [user('u1', '', { displayName: null, discordLinked: false }), user('u2', '', { displayName: 'Typed', discordLinked: false })] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithProviders(<UsersAdmin />);
    expect(await screen.findByText('Discord name not set', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Typed')).toBeInTheDocument();
    expect(screen.getByText('Discord name not set', { selector: 'small' })).toBeInTheDocument();
    expect(screen.queryByText('unverified')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ban Typed' }));
    expect(confirm).toHaveBeenCalledWith('Ban Typed? Their open posts will close.');
  });

  it('no ban button for admin users; banned user shows pill and Unban', async () => {
    mockApi(usersRoutes());
    renderWithProviders(<UsersAdmin />);
    await screen.findByText('root');
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ban root|Unban root/ })).not.toBeInTheDocument();
    expect(screen.getByText('Banned')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unban bobby' })).toBeInTheDocument();
  });

  it('reassign choice uses the display name in its label and confirm text', async () => {
    const post = vi.fn(() => char);
    mockApi({
      ...usersRoutes({ '/api/admin/users/u1/characters': [char], 'POST /api/admin/characters/c1/reassign': post }),
      '/api/admin/users': [user('u1', 'bob'), user('u2', 'root', { displayName: 'Maple Friend' })],
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show characters bob' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reassign Mapler' }));
    const panel = screen.getByRole('group', { name: 'Reassign Mapler' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Choose Maple Friend' }));
    expect(confirm).toHaveBeenCalledWith('Reassign Mapler to Maple Friend (@root)?');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it('reassign flow posts {userId}', async () => {
    const post = vi.fn(() => char);
    mockApi(usersRoutes({
      '/api/admin/users/u1/characters': [char],
      'POST /api/admin/characters/c1/reassign': post,
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show characters bob' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reassign Mapler' }));
    const panel = screen.getByRole('group', { name: 'Reassign Mapler' });
    // excludes the current owner (bob) and banned users (bobby)
    expect(await within(panel).findByRole('button', { name: 'Choose root' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Choose bob' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Choose bobby' })).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Choose root' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(bodyOf(post.mock.calls[0] as unknown[])).toEqual({ userId: 'u2' });
  });

  it('delete character confirms then DELETEs', async () => {
    const del = vi.fn(() => undefined);
    mockApi(usersRoutes({ '/api/admin/users/u1/characters': [char], 'DELETE /api/admin/characters/c1': del }));
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show characters bob' }));
    const btn = await screen.findByRole('button', { name: 'Delete Mapler' });
    fireEvent.click(btn);
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(btn);
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
  });
});

const post = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: 'recruiting', world: { id: 1, name: 'Scania' }, guild: { id: 'g', name: 'Alpha' },
  poster: { snapshot: { ign: 'Mapler' } }, bosses: [{ bossDifficultyId: 1, bossName: 'Lucid', difficulty: 'Hard' }],
  scheduledAt: null, expiresAt: '2026-12-01T00:00:00Z', createdAt: new Date().toISOString(),
  partySize: 6, memberCount: 1, minCp: null, note: '', status: 'open', deleted: false, isPoster: false,
  deletedAt: null, closedReason: null, posterDiscordUsername: 'bob', posterDiscordLinked: true, ...over,
});

describe('admin posts', () => {
  it('posts filter Deleted → GET /api/admin/posts?status=deleted', async () => {
    const fetchMock = mockApi({
      '/api/admin/posts?status=all': [post('p1')],
      '/api/admin/posts?status=deleted': [post('p2', { deleted: true, deletedAt: '2026-02-01T00:00:00Z' })],
    });
    renderWithProviders(<PostsAdmin />);
    expect(await screen.findByText(/Hard Lucid/)).toBeInTheDocument();
    expect(screen.getByText(/bob/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Deleted' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/admin/posts?status=deleted')).toBe(true),
    );
    expect(await screen.findByRole('link', { name: 'View p2' })).toBeInTheDocument();
  });

  it("marks a poster's unverified Discord name", async () => {
    mockApi({ '/api/admin/posts?status=all': [post('p1', { posterDiscordUsername: 'typed_name', posterDiscordLinked: false }), post('p2', { posterDiscordLinked: true })] });
    renderWithProviders(<PostsAdmin />);
    expect(await screen.findByText('Mapler (typed_name, unverified)')).toBeInTheDocument();
    expect(screen.getByText('Mapler (bob)')).toBeInTheDocument();
  });

  it("shows a poster's cleared Discord name as not set", async () => {
    mockApi({ '/api/admin/posts?status=all': [post('p1', { posterDiscordUsername: '', posterDiscordLinked: false })] });
    renderWithProviders(<PostsAdmin />);
    expect(await screen.findByText('Mapler (Discord name not set)')).toBeInTheDocument();
  });

  it('Delete permanently confirms then DELETEs /api/admin/posts/:id', async () => {
    const del = vi.fn(() => undefined);
    mockApi({ '/api/admin/posts?status=all': [post('p1')], 'DELETE /api/admin/posts/p1': del });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<PostsAdmin />);
    const btn = await screen.findByRole('button', { name: 'Delete permanently p1' });
    expect(screen.getByRole('link', { name: 'View p1' })).toHaveAttribute('href', '/posts/p1');
    fireEvent.click(btn);
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(btn);
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
  });
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { GuildsAdmin } from '../src/pages/admin/GuildsAdmin';
import { UsersAdmin } from '../src/pages/admin/UsersAdmin';
import { WorldsAdmin } from '../src/pages/admin/WorldsAdmin';
import { mockApi, renderWithProviders } from './setup';

/** Makes requests matching `when` fail with an API error body; everything else goes to the existing mock. */
function failWhen(fetchMock: ReturnType<typeof mockApi>, when: (method: string, url: string) => boolean, status: number, error: Record<string, unknown>) {
  const base = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) => {
    if (when((init?.method ?? 'GET').toUpperCase(), String(input))) return new Response(JSON.stringify({ error }), { status });
    return base(input, init);
  });
}

const guild = (id: string, name: string) => ({ id, name, iconUrl: null, worldIds: [1], active: true, webhookUrl: null });

describe('guild delete', () => {
  it('opens a confirm with usage counts, deletes, refreshes, and focus moves to the page heading', async () => {
    let guilds = [guild('g1', 'Alpha'), guild('g2', 'Beta')];
    const del = vi.fn(() => { guilds = guilds.filter((g) => g.id !== 'g1'); return undefined; });
    mockApi({
      '/api/admin/guilds': () => guilds,
      '/api/worlds?all=1': [],
      '/api/bosses': [],
      '/api/admin/guilds/g1/usage': { characters: 3, posts: 1 },
      'DELETE /api/admin/guilds/g1': del,
    });
    renderWithProviders(<GuildsAdmin />);
    const opener = await screen.findByRole('button', { name: 'Delete Alpha' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Delete Alpha?' });
    expect(await within(dialog).findByText('3 characters will have no guild and 1 post will lose it as its Discord destination.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('Delete guild'));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Alpha' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Delete Beta' })).toBeInTheDocument();
    expect(document.querySelector('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Guilds' })).toHaveFocus();
  });

  it('pluralizes counts and disables Delete guild while counts load', async () => {
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((r) => { release = r; });
    const fetchMock = mockApi({
      '/api/admin/guilds': [guild('g1', 'Alpha')],
      '/api/worlds?all=1': [],
      '/api/bosses': [],
      '/api/admin/guilds/g1/usage': { characters: 1, posts: 2 },
    });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (i, init) => { if (String(i).endsWith('/usage')) await gate; return base(i, init); });
    renderWithProviders(<GuildsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Alpha' }));
    const confirmBtn = await screen.findByText('Delete guild');
    expect(confirmBtn).toBeDisabled();
    release(undefined);
    expect(await screen.findByText('1 character will have no guild and 2 posts will lose it as their Discord destination.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Delete guild')).toBeEnabled());
  });

  it('shows a delete error inside the dialog', async () => {
    const fetchMock = mockApi({
      '/api/admin/guilds': [guild('g1', 'Alpha')],
      '/api/worlds?all=1': [],
      '/api/bosses': [],
      '/api/admin/guilds/g1/usage': { characters: 0, posts: 0 },
    });
    failWhen(fetchMock, (m) => m === 'DELETE', 500, { code: 'BOOM', message: 'Server exploded' });
    renderWithProviders(<GuildsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Alpha' }));
    await waitFor(() => expect(screen.getByText('Delete guild')).toBeEnabled());
    fireEvent.click(screen.getByText('Delete guild'));
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    expect(document.querySelector('dialog')).not.toBeNull();
  });

  it('Cancel closes the dialog and returns focus to the Delete button', async () => {
    mockApi({
      '/api/admin/guilds': [guild('g1', 'Alpha')],
      '/api/worlds?all=1': [],
      '/api/bosses': [],
      '/api/admin/guilds/g1/usage': { characters: 0, posts: 0 },
    });
    renderWithProviders(<GuildsAdmin />);
    const opener = await screen.findByRole('button', { name: 'Delete Alpha' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(document.querySelector('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });
});

const world = (id: number, name: string) => ({ id, nexonWorldId: id, name, worldType: 'heroic', active: true });

describe('world delete', () => {
  const routes = (extra: Record<string, unknown> = {}) => ({
    '/api/worlds?all=1': [world(1, 'Kronos'), world(2, 'Scania')],
    '/api/admin/worlds/2/usage': { characters: 4, posts: 2, leavingGuild: { characters: 0, posts: 0 } },
    ...extra,
  });

  it('has no Delete on the Kronos row (case-insensitive) but on others', async () => {
    mockApi({ '/api/worlds?all=1': [world(1, 'KRONOS'), world(2, 'Scania')] });
    renderWithProviders(<WorldsAdmin />);
    expect(await screen.findByRole('button', { name: 'Delete Scania' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete KRONOS' })).not.toBeInTheDocument();
  });

  it('confirms with counts, DELETEs, and refreshes', async () => {
    let worlds = [world(1, 'Kronos'), world(2, 'Scania')];
    const del = vi.fn(() => { worlds = worlds.filter((w) => w.id !== 2); return undefined; });
    mockApi(routes({ '/api/worlds?all=1': () => worlds, 'DELETE /api/admin/worlds/2': del }));
    renderWithProviders(<WorldsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Scania' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Scania?' });
    expect(await within(dialog).findByText('4 characters and 2 posts will move to Kronos.')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText('Delete world')).toBeEnabled());
    fireEvent.click(within(dialog).getByText('Delete world'));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Scania' })).not.toBeInTheDocument());
    expect(document.querySelector('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Worlds' })).toHaveFocus();
    expect(within(dialog).queryByText(/leave a guild/)).toBeNull();
  });

  it('says how many characters and posts will leave a guild that does not play on Kronos', async () => {
    mockApi(routes({ '/api/admin/worlds/2/usage': { characters: 4, posts: 2, leavingGuild: { characters: 3, posts: 1 } } }));
    renderWithProviders(<WorldsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Scania' }));
    expect(await screen.findByText("3 characters and 1 post will leave a guild that doesn't play on Kronos.")).toBeInTheDocument();
  });

  it('only characters leaving: no post count in the guild line', async () => {
    mockApi(routes({ '/api/admin/worlds/2/usage': { characters: 4, posts: 2, leavingGuild: { characters: 1, posts: 0 } } }));
    renderWithProviders(<WorldsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Scania' }));
    expect(await screen.findByText("1 character will leave a guild that doesn't play on Kronos.")).toBeInTheDocument();
  });

  it('Cancel returns focus to the Delete button', async () => {
    mockApi(routes());
    renderWithProviders(<WorldsAdmin />);
    const opener = await screen.findByRole('button', { name: 'Delete Scania' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(document.querySelector('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('a failed delete then Cancel returns focus to the Delete button, not the heading', async () => {
    const fetchMock = mockApi(routes());
    failWhen(fetchMock, (m) => m === 'DELETE', 409, { code: 'WORLD_CHANGED', message: 'x' });
    renderWithProviders(<WorldsAdmin />);
    const opener = await screen.findByRole('button', { name: 'Delete Scania' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Delete world')).toBeEnabled());
    fireEvent.click(within(dialog).getByText('Delete world'));
    expect(await within(dialog).findByText('This world changed while it was being deleted. Try again.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('Cancel'));
    await waitFor(() => expect(document.querySelector('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('KRONOS_INACTIVE explains what to do', async () => {
    const fetchMock = mockApi(routes());
    failWhen(fetchMock, (m) => m === 'DELETE', 409, { code: 'KRONOS_INACTIVE', message: 'x' });
    renderWithProviders(<WorldsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Scania' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Delete world')).toBeEnabled());
    fireEvent.click(within(dialog).getByText('Delete world'));
    expect(await within(dialog).findByText('Turn Kronos back on first: characters from a deleted world move there.')).toBeInTheDocument();
  });

  it('singular counts', async () => {
    mockApi(routes({ '/api/admin/worlds/2/usage': { characters: 1, posts: 1, leavingGuild: { characters: 0, posts: 0 } } }));
    renderWithProviders(<WorldsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Scania' }));
    expect(await screen.findByText('1 character and 1 post will move to Kronos.')).toBeInTheDocument();
  });

  it('WORLD_NAME_CLASH shows its message and the clashing IGNs as a list', async () => {
    const fetchMock = mockApi(routes());
    failWhen(fetchMock, (m) => m === 'DELETE', 409, { code: 'WORLD_NAME_CLASH', message: 'These characters already exist on Kronos: Aa, Bb. Rename or remove them first.', igns: ['Aa', 'Bb'] });
    renderWithProviders(<WorldsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Scania' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Delete world')).toBeEnabled());
    fireEvent.click(within(dialog).getByText('Delete world'));
    expect(await within(dialog).findByText('These characters already exist on Kronos. Rename or remove them first:')).toBeInTheDocument();
    const items = within(within(dialog).getByRole('list')).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['Aa', 'Bb']);
    // The names are listed once, not also inside the message.
    expect(within(dialog).queryByText(/Aa, Bb/)).toBeNull();
  });
});

const user = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, discordUsername: name, displayName: null, avatarUrl: null, banned: false, deletedAt: null as string | null, isAdmin: false,
  createdAt: '2026-01-01T00:00:00Z', characterCount: 1, discordLinked: true, ...over,
});

describe('user delete', () => {
  const list = [user('u1', 'bob'), user('u2', 'root', { isAdmin: true }), user('u3', 'gone', { deletedAt: '2026-02-01T00:00:00Z' })];

  it('Delete only for non-deleted, non-admin users; deleted users get a pill and Reactivate', async () => {
    mockApi({ '/api/admin/users': list, '/api/rarity-tiers': [] });
    renderWithProviders(<UsersAdmin />);
    expect(await screen.findByRole('button', { name: 'Delete account bob' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete account root' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete account gone' })).not.toBeInTheDocument();
    expect(screen.getByText('Deleted', { selector: 'span' })).toHaveClass('pill', 'pill--red');
    expect(screen.getByRole('button', { name: 'Reactivate gone' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate bob' })).not.toBeInTheDocument();
  });

  it('confirms, DELETEs, and refreshes', async () => {
    let users = list;
    const del = vi.fn(() => { users = users.map((u) => (u.id === 'u1' ? { ...u, deletedAt: '2026-03-01T00:00:00Z' } : u)); return users[0]; });
    mockApi({ '/api/admin/users': () => users, '/api/rarity-tiers': [], 'DELETE /api/admin/users/u1': del });
    renderWithProviders(<UsersAdmin />);
    const opener = await screen.findByRole('button', { name: 'Delete account bob' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Delete bob?' });
    expect(within(dialog).getByText("They won't be able to sign in and their open posts will close. You can reactivate the account later.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('Delete account'));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Reactivate bob' })).toBeInTheDocument();
    expect(document.querySelector('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Users' })).toHaveFocus();
  });

  it('shows a delete error in the dialog', async () => {
    const fetchMock = mockApi({ '/api/admin/users': list, '/api/rarity-tiers': [] });
    failWhen(fetchMock, (m) => m === 'DELETE', 400, { code: 'CANNOT_DELETE_ADMIN', message: 'Admins cannot be deleted' });
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete account bob' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Delete account'));
    expect(await screen.findByText("Admins can't be deleted.")).toBeInTheDocument();
  });

  it('Reactivate POSTs without a confirm', async () => {
    const post = vi.fn(() => user('u3', 'gone'));
    const confirm = vi.spyOn(window, 'confirm');
    mockApi({ '/api/admin/users': list, '/api/rarity-tiers': [], 'POST /api/admin/users/u3/reactivate': post });
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate gone' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('status filter sends ?status=', async () => {
    const fetchMock = mockApi({ '/api/admin/users': list, '/api/admin/users?status=deleted': [list[2]], '/api/admin/users?status=active': [list[0]], '/api/rarity-tiers': [] });
    renderWithProviders(<UsersAdmin />);
    await screen.findByText('bob');
    const select = screen.getByRole('combobox', { name: 'Filter by status' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Active', 'Deleted']);
    fireEvent.change(select, { target: { value: 'deleted' } });
    expect(await screen.findByText('gone')).toBeInTheDocument();
    expect(screen.queryByText('bob')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/admin/users?status=deleted')).toBe(true);
  });
});

describe('admin user characters layout', () => {
  it('renders each character as a column (card, actions, picker) inside the .admin__chars grid', async () => {
    const c = {
      id: 'c1', ign: 'Mapler', level: 250, jobName: 'Bishop', combatPower: 1_000_000, imageUrl: '',
      world: { id: 1, name: 'Scania' }, guild: null, cpUpdatedAt: '2026-01-01T00:00:00Z', screenshotUrl: null,
      owner: { discordUsername: 'bob', displayName: null, discordLinked: true },
    };
    const fetchMock = mockApi({ '/api/admin/users': [user('u1', 'bob'), user('u2', 'amy')], '/api/admin/users?status=active': [user('u1', 'bob'), user('u2', 'amy')], '/api/rarity-tiers': [], '/api/admin/users/u1/characters': [c] });
    renderWithProviders(<UsersAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show characters bob' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reassign Mapler' }));
    const char = (await screen.findByRole('group', { name: 'Reassign Mapler' })).closest('.admin__char')!;
    expect(char.parentElement).toHaveClass('admin__chars');
    expect(char.querySelector(':scope > .card')).not.toBeNull();
    expect(char.querySelector(':scope > .admin__row')).not.toBeNull();
    expect(char.querySelector(':scope > .admin__picker')).not.toBeNull();
    // The new-owner picker asks the server for active accounts only.
    expect(await screen.findByRole('button', { name: 'Choose amy' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/admin/users?status=active')).toBe(true);
  });
});


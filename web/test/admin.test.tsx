import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUpdateGuild } from '../src/api/hooks';
import { Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../src/pages/admin/AdminLayout';
import { GuildsAdmin } from '../src/pages/admin/GuildsAdmin';
import { ClassesAdmin } from '../src/pages/admin/ClassesAdmin';
import { TiersAdmin } from '../src/pages/admin/TiersAdmin';
import { mockApi, renderWithProviders } from './setup';

const admin = { id: 'u1', discordUsername: 'boss', avatarUrl: null, isAdmin: true };
const worlds = [
  { id: 1, nexonWorldId: 10, name: 'Scania', worldType: 'heroic', active: true },
  { id: 2, nexonWorldId: 20, name: 'Bera', worldType: 'heroic', active: true },
];

function body(init?: RequestInit) {
  return JSON.parse(String(init?.body));
}

describe('admin pages', () => {
  it('edits and clears boss role mappings for a guild', async () => {
    let guild = { id: 'g1', name: 'G', iconUrl: null, worldIds: [1], active: true, webhookUrl: null, bossRoleIds: { '7': '111111111111111111' } as Record<string, string> };
    const patch = vi.fn((init?: RequestInit) => {
      guild = { ...guild, ...body(init) };
      return guild;
    });
    mockApi({
      '/api/admin/guilds': () => [guild],
      '/api/worlds?all=1': worlds,
      '/api/bosses': [{ id: 7, name: 'Lucid', imageUrl: null, difficulties: [] }],
      'PATCH /api/admin/guilds/g1': patch,
    });
    renderWithProviders(<GuildsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit G' }));
    fireEvent.click(screen.getByText('Boss role pings'));
    expect(await screen.findByLabelText('Lucid role ID')).toHaveValue('111111111111111111');
    fireEvent.change(screen.getByLabelText('Lucid role ID'), { target: { value: '222222222222222222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save guild' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(body(patch.mock.calls[0][0]).bossRoleIds).toEqual({ '7': '222222222222222222' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save guild' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Edit G' }));
    fireEvent.click(screen.getByText('Boss role pings'));
    fireEvent.change(screen.getByLabelText('Lucid role ID'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save guild' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(body(patch.mock.calls[1][0]).bossRoleIds).toEqual({});
  });

  it('rejects a malformed boss role ID with a visible message instead of a silent blocked submit', async () => {
    const guild = { id: 'g1', name: 'G', iconUrl: null, worldIds: [1], active: true, webhookUrl: null, bossRoleIds: {} as Record<string, string> };
    const patch = vi.fn(() => guild);
    mockApi({
      '/api/admin/guilds': () => [guild],
      '/api/worlds?all=1': worlds,
      '/api/bosses': [{ id: 7, name: 'Lucid', imageUrl: null, difficulties: [] }],
      'PATCH /api/admin/guilds/g1': patch,
    });
    renderWithProviders(<GuildsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit G' }));
    fireEvent.click(screen.getByText('Boss role pings'));
    fireEvent.change(await screen.findByLabelText('Lucid role ID'), { target: { value: '12345' } });
    fireEvent.click(screen.getByText('Boss role pings'));
    fireEvent.click(screen.getByRole('button', { name: 'Save guild' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Lucid role ID must be a Discord role ID (17–20 digits).');
    expect(patch).not.toHaveBeenCalled();
  });

  it('non-admin sees Not authorized', async () => {
    mockApi({ '/api/auth/me': { ...admin, isAdmin: false } });
    renderWithProviders(
      <Routes>
        <Route path="admin" element={<AdminLayout />} />
      </Routes>,
      { route: '/admin' },
    );
    expect(await screen.findByText('Not authorized')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Guilds' })).not.toBeInTheDocument();
  });

  it('create guild posts worldIds from checked boxes', async () => {
    const post = vi.fn(() => ({}));
    mockApi({
      '/api/admin/guilds': [],
      '/api/bosses': [],
      '/api/worlds?all=1': worlds,
      'POST /api/admin/guilds': post,
    });
    renderWithProviders(<GuildsAdmin />);
    const u = {
      click: async (el: Element) => void fireEvent.click(el),
      type: async (el: Element, v: string) => void fireEvent.change(el, { target: { value: v } }),
    };
    await u.click(await screen.findByRole('button', { name: 'Add guild' }));
    await u.type(screen.getByLabelText('Name'), 'Maple Crew');
    await u.click(await screen.findByRole('checkbox', { name: 'Bera' }));
    await u.click(screen.getByRole('button', { name: 'Create guild' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const calls = post.mock.calls as unknown as [RequestInit][];
    expect(body(calls[0][0])).toEqual({ name: 'Maple Crew', iconUrl: null, webhookUrl: null, worldIds: [2], bossRoleIds: {} });
  });

  it('webhook input is masked until Show is pressed', async () => {
    mockApi({
      '/api/admin/guilds': [
        { id: 'g1', name: 'G', iconUrl: null, worldIds: [1], active: true, webhookUrl: 'https://discord.com/api/webhooks/1/abc' },
      ],
      '/api/worlds?all=1': worlds,
    });
    renderWithProviders(<GuildsAdmin />);
    const u = {
      click: async (el: Element) => void fireEvent.click(el),
      type: async (el: Element, v: string) => void fireEvent.change(el, { target: { value: v } }),
    };
    await u.click(await screen.findByRole('button', { name: 'Edit G' }));
    const input = screen.getByLabelText('Webhook URL');
    expect(input).toHaveAttribute('type', 'password');
    await u.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.queryAllByText(/discord\.com\/api\/webhooks/)).toHaveLength(0);
  });

  it('tiers save sends PUT with numeric minCp and shows NEEDS_BASE_TIER error', async () => {
    const put = vi.fn((_init?: RequestInit) => undefined);
    const fetchMock = mockApi({
      '/api/rarity-tiers': [
        { id: 1, name: 'Common', minCp: 0, sortOrder: 0 },
        { id: 2, name: 'Rare', minCp: 1000, sortOrder: 1 },
      ],
      'PUT /api/admin/rarity-tiers': put,
    });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'PUT') {
        put(init);
        return new Response(
          JSON.stringify({ error: { code: 'NEEDS_BASE_TIER', message: 'A tier with minCp 0 is required' } }),
          { status: 400 },
        );
      }
      return base(input, init);
    });
    renderWithProviders(<TiersAdmin />);
    const u = {
      click: async (el: Element) => void fireEvent.click(el),
      type: async (el: Element, v: string) => void fireEvent.change(el, { target: { value: v } }),
    };
    const minCps = await screen.findAllByLabelText('Min CP');
    await u.type(minCps[0], '5');
    await u.click(screen.getByRole('button', { name: 'Save tiers' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const sent = body(put.mock.calls[0][0]);
    expect(sent.tiers).toEqual([
      { name: 'Common', minCp: 5, sortOrder: 0 },
      { name: 'Rare', minCp: 1000, sortOrder: 1 },
    ]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/base tier/i);
  });

  describe('classes admin', () => {
    const classes = [
      { id: 2, name: 'Bishop', archetype: 'magician' },
      { id: 1, name: 'Adele', archetype: 'warrior' },
    ];
    const u = {
      click: async (el: Element) => void fireEvent.click(el),
      type: async (el: Element, v: string) => void fireEvent.change(el, { target: { value: v } }),
    };

    it('lists classes alphabetically', async () => {
      mockApi({ '/api/classes': classes });
      renderWithProviders(<ClassesAdmin />);
      await screen.findByText('Adele');
      const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
      expect(names).toEqual(['Adele', 'Bishop']);
    });

    it('adds a class with name and archetype', async () => {
      const post = vi.fn((_init?: RequestInit) => ({}));
      mockApi({ '/api/classes': classes, 'POST /api/admin/classes': post });
      renderWithProviders(<ClassesAdmin />);
      await u.type(await screen.findByLabelText('Class name'), 'Lynn');
      await u.type(screen.getByLabelText('New class archetype'), 'magician');
      await u.click(screen.getByRole('button', { name: 'Add class' }));
      await waitFor(() => expect(post).toHaveBeenCalled());
      expect(body(post.mock.calls[0][0])).toEqual({ name: 'Lynn', archetype: 'magician' });
    });

    it('changes an archetype via the row select', async () => {
      const patch = vi.fn((_init?: RequestInit) => ({}));
      mockApi({ '/api/classes': classes, 'PATCH /api/admin/classes/1': patch });
      renderWithProviders(<ClassesAdmin />);
      await u.type(await screen.findByLabelText('Archetype for Adele'), 'thief');
      await waitFor(() => expect(patch).toHaveBeenCalled());
      expect(body(patch.mock.calls[0][0])).toEqual({ archetype: 'thief' });
    });

    it("disables a row's archetype select while its update is pending", async () => {
      const api = mockApi({ '/api/classes': classes });
      let release = () => {};
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'PATCH'
          ? new Promise<Response>((r) => {
              release = () => r(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
            })
          : api(input, init),
      );
      renderWithProviders(<ClassesAdmin />);
      const adele = await screen.findByLabelText('Archetype for Adele');
      await u.type(adele, 'thief');
      await waitFor(() => expect(adele).toBeDisabled());
      expect(screen.getByLabelText('Archetype for Bishop')).toBeEnabled();
      release();
      await waitFor(() => expect(adele).toBeEnabled());
    });

    it('removes a class after confirm', async () => {
      const del = vi.fn((_init?: RequestInit) => undefined);
      mockApi({ '/api/classes': classes, 'DELETE /api/admin/classes/2': del });
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
      renderWithProviders(<ClassesAdmin />);
      const btn = await screen.findByRole('button', { name: 'Delete Bishop' });
      await u.click(btn);
      expect(del).not.toHaveBeenCalled();
      await u.click(btn);
      await waitFor(() => expect(del).toHaveBeenCalled());
      expect(confirm).toHaveBeenCalledWith('Delete Bishop?');
      confirm.mockRestore();
    });

    it('admin layout links to Classes', async () => {
      mockApi({ '/api/auth/me': admin });
      renderWithProviders(
        <Routes>
          <Route path="admin" element={<AdminLayout />} />
        </Routes>,
        { route: '/admin' },
      );
      expect(await screen.findByRole('link', { name: 'Classes' })).toHaveAttribute('href', '/admin/classes');
    });
  });

  it('admin mutations also invalidate character queries (guild/world names on cards)', async () => {
    mockApi({ 'PATCH /api/admin/guilds/g1': { id: 'g1' } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateGuild(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 'g1', name: 'Renamed' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['characters'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['posts'] });
  });
});

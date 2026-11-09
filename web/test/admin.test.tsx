import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUpdateGuild } from '../src/api/hooks';
import { Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../src/pages/admin/AdminLayout';
import { GuildsAdmin } from '../src/pages/admin/GuildsAdmin';
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
    expect(body(calls[0][0])).toEqual({ name: 'Maple Crew', iconUrl: null, webhookUrl: null, worldIds: [2] });
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
  });
});

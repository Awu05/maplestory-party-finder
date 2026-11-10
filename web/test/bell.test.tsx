import { readFileSync } from 'node:fs';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { NotificationDTO } from '@pf/shared';
import { App } from '../src/App';
import { NOTIFICATION_POLL_MS } from '../src/api/notifyHooks';
import { mockApi, renderWithProviders, setViewport, testQueryClient } from './setup';

const user = { id: 'u1', discordUsername: 'maple_fan', avatarUrl: null, isAdmin: false };
const note = (id: string, over: Partial<NotificationDTO> = {}): NotificationDTO => ({
  id,
  kind: 'x',
  text: `Note ${id}`,
  link: `/posts/${id}`,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  read: false,
  ...over,
});
const list = (items: NotificationDTO[], unreadCount = items.filter((i) => !i.read).length) => ({ items, unreadCount });
const NOTIF = '/api/notifications?limit=30';

describe('NotificationBell', () => {
  it('badge shows 3; 12 unread shows 9+; hidden at 0', async () => {
    mockApi({ '/api/auth/me': user, [NOTIF]: list([note('a')], 3) });
    const first = renderWithProviders(<App />);
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toHaveTextContent('3');
    first.unmount();

    mockApi({ '/api/auth/me': user, [NOTIF]: list([note('a')], 12) });
    renderWithProviders(<App />);
    expect(await screen.findByRole('button', { name: 'Notifications, 12 unread' })).toHaveTextContent('9+');
  });

  it('badge hidden at 0', async () => {
    mockApi({ '/api/auth/me': user, [NOTIF]: list([], 0) });
    renderWithProviders(<App />);
    const btn = await screen.findByRole('button', { name: 'Notifications, 0 unread' });
    expect(btn).not.toHaveTextContent(/\d/);
  });

  it('opening lists items; clicking one posts read {ids} and navigates to its link', async () => {
    const fetchMock = mockApi({
      '/api/auth/me': user,
      [NOTIF]: list([note('n1', { link: '/me/parties' }), note('n2', { read: true })]),
      'POST /api/notifications/read': undefined,
      '/api/me/parties': [],
    });
    renderWithProviders(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));
    expect(await screen.findByText('Note n2')).toBeInTheDocument();
    expect(screen.getAllByText('5m ago')).toHaveLength(2);
    fireEvent.click(screen.getByText('Note n1'));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/notifications/read' && i?.method === 'POST');
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toEqual({ ids: ['n1'] });
    });
    await waitFor(() => expect(screen.queryByText('Note n2')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/me/parties')).toBe(true),
    );
  });

  it('Mark all read posts {all:true}', async () => {
    const fetchMock = mockApi({
      '/api/auth/me': user,
      [NOTIF]: list([note('n1')]),
      'POST /api/notifications/read': undefined,
    });
    renderWithProviders(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/notifications/read' && i?.method === 'POST');
      expect(JSON.parse(String(call![1]!.body))).toEqual({ all: true });
    });
  });

  it('empty state', async () => {
    mockApi({ '/api/auth/me': user, [NOTIF]: list([]) });
    renderWithProviders(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));
    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  });

  it('closes on Escape and on outside click', async () => {
    mockApi({ '/api/auth/me': user, [NOTIF]: list([]) });
    renderWithProviders(<App />);
    const btn = await screen.findByRole('button', { name: /^Notifications/ });
    fireEvent.click(btn);
    await screen.findByText("You're all caught up.");
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText("You're all caught up.")).not.toBeInTheDocument();
    fireEvent.click(btn);
    await screen.findByText("You're all caught up.");
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("You're all caught up.")).not.toBeInTheDocument();
  });

  it('Escape from inside the panel returns focus to the bell button', async () => {
    mockApi({ '/api/auth/me': user, [NOTIF]: list([note('n1')]) });
    renderWithProviders(<App />);
    const btn = await screen.findByRole('button', { name: /^Notifications/ });
    fireEvent.click(btn);
    const item = (await screen.findByText('Note n1')).closest('button')!;
    item.focus();
    expect(item).toHaveFocus();
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByText('Note n1')).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
  });

  it('the bell button does not announce a menu popup; the panel is a named region', async () => {
    mockApi({ '/api/auth/me': user, [NOTIF]: list([]) });
    renderWithProviders(<App />);
    const btn = await screen.findByRole('button', { name: /^Notifications/ });
    expect(btn).not.toHaveAttribute('aria-haspopup');
    fireEvent.click(btn);
    expect(await screen.findByRole('region', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('not rendered when logged out', async () => {
    mockApi({ '/api/auth/me': null });
    renderWithProviders(<App />);
    await screen.findByRole('link', { name: 'Log in with Discord' });
    expect(screen.queryByRole('button', { name: /^Notifications/ })).not.toBeInTheDocument();
  });

  it('?login=banned shows banned banner', async () => {
    mockApi({ '/api/auth/me': null });
    renderWithProviders(<App />, { route: '/?login=banned' });
    expect(await screen.findByText('Your account has been banned.')).toBeInTheDocument();
  });

  it('polls every 30s and refetches on focus', async () => {
    mockApi({ '/api/auth/me': user, [NOTIF]: list([]) });
    const client = testQueryClient();
    renderWithProviders(<App />, { client });
    await screen.findByRole('button', { name: /^Notifications/ });
    const opts = client.getQueryCache().find({ queryKey: ['notifications'] })!.options as { refetchInterval?: unknown; refetchOnWindowFocus?: unknown };
    expect(NOTIFICATION_POLL_MS).toBe(30_000);
    expect(opts.refetchInterval).toBe(30_000);
    expect(opts.refetchOnWindowFocus).toBe(true);
  });

  it('a new newest notification invalidates posts; the first load does not', async () => {
    let current = list([note('n1')]);
    mockApi({ '/api/auth/me': user, [NOTIF]: () => current });
    const client = testQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderWithProviders(<App />, { client });
    await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['posts'] });
    current = list([note('n2'), note('n1')]);
    await client.refetchQueries({ queryKey: ['notifications'] });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['posts'] }));
  });

  it('logout removes the notifications query', async () => {
    mockApi({ '/api/auth/me': user, [NOTIF]: list([note('n1')]), 'POST /api/auth/logout': undefined });
    const client = testQueryClient();
    client.setQueryDefaults(['notifications'], { gcTime: Infinity });
    renderWithProviders(<App />, { client });
    await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByRole('link', { name: 'Log in with Discord' });
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['notifications'] })).toHaveLength(0));
  });

  it('positions the phone panel below the header as it is rendered when opened', async () => {
    mockApi({ '/api/auth/me': user, [NOTIF]: list([note('n1')]) });
    renderWithProviders(<App />);
    const bell = await screen.findByRole('button', { name: /^Notifications/ });
    const header = bell.closest('.app-header') as HTMLElement;
    header.getBoundingClientRect = () => ({ bottom: 97 }) as DOMRect;
    fireEvent.click(bell);
    const panel = await screen.findByRole('region', { name: 'Notifications' });
    expect(panel.style.getPropertyValue('--bell-top')).toBe('97px');
  });

  it('re-measures the header on resize and scroll while open on a phone, and stops when closed', async () => {
    setViewport(375);
    mockApi({ '/api/auth/me': user, [NOTIF]: list([note('n1')]) });
    renderWithProviders(<App />);
    const bell = await screen.findByRole('button', { name: /^Notifications/ });
    const header = bell.closest('.app-header') as HTMLElement;
    header.getBoundingClientRect = () => ({ bottom: 97 }) as DOMRect;
    fireEvent.click(bell);
    const panel = await screen.findByRole('region', { name: 'Notifications' });
    header.getBoundingClientRect = () => ({ bottom: 140 }) as DOMRect;
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(panel.style.getPropertyValue('--bell-top')).toBe('140px'));
    header.getBoundingClientRect = () => ({ bottom: 0 }) as DOMRect;
    fireEvent.scroll(window);
    await waitFor(() => expect(panel.style.getPropertyValue('--bell-top')).toBe('0px'));
    const remove = vi.spyOn(window, 'removeEventListener');
    fireEvent.click(bell);
    expect(remove.mock.calls.map(([t]) => t)).toEqual(expect.arrayContaining(['scroll', 'resize']));
    remove.mockRestore();
  });

  it('phone panel max-height uses dynamic viewport units with a vh fallback', () => {
    const css = readFileSync('src/components/bell.css', 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 640px)'));
    const panel = /\.bell-panel\s*\{([^}]*)\}/.exec(phone)?.[1] ?? '';
    const heights = [...panel.matchAll(/max-height:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(heights).toEqual(['calc(100vh - var(--bell-top))', 'calc(100dvh - var(--bell-top))']);
  });

  it('phone panel CSS uses the measured header bottom', () => {
    const css = readFileSync('src/components/bell.css', 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 640px)'));
    const panel = /\.bell-panel\s*\{([^}]*)\}/.exec(phone)?.[1] ?? '';
    expect(panel).toMatch(/top:\s*var\(--bell-top/);
    expect(panel).not.toMatch(/3\.25rem/);
  });
});

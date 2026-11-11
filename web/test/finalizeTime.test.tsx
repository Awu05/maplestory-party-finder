import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostDetailDTO } from '@pf/shared';
import { PostDetailPage } from '../src/pages/PostDetailPage';
import { localInputToUtcIso, utcIsoToLocalInput, whenLabel } from '../src/components/post/time';
import { mockApi, renderWithProviders } from './setup';

vi.mock('../src/lib/timeZone', () => ({ browserTimeZone: () => 'America/New_York' }));

const poster = {
  id: 'm1',
  role: 'poster',
  characterId: 'c-m1',
  cpAtJoin: 1,
  joinedAt: '2026-11-09T00:00:00Z',
  character: null,
  snapshot: { ign: 'Lily', jobName: 'Bishop', level: 280, imageUrl: 'http://i/x.png', worldName: 'Kronos', guildName: 'G' },
  freeTimes: [], freeTimesZone: null, isMine: true,
} as PostDetailDTO['poster'];

const post = (over: Partial<PostDetailDTO> = {}): PostDetailDTO => ({
  id: 'p1',
  type: 'recruiting',
  world: { id: 5, name: 'Kronos' },
  guild: { id: 'g1', name: 'G' },
  poster,
  bosses: [{ bossDifficultyId: 7, bossName: 'Lucid', difficulty: 'Hard' }],
  scheduledAt: null,
  freeTimes: [],
  weeklyTimeZone: null, freeTimesZone: null,
  expiresAt: '2026-12-02T00:00:00Z',
  createdAt: '2026-11-09T00:00:00Z',
  partySize: 4,
  memberCount: 1,
  minCp: null,
  note: '',
  status: 'open',
  deleted: false,
  isPoster: true,
  members: [poster],
  isMember: true,
  incomingRequests: [],
  sentInvites: [],
  myPending: [],
  receivedInvites: [],
  sentInvitesToThis: [],
  canRenew: false,
  ...over,
});

function renderPage(routes: Record<string, unknown>) {
  const fetchMock = mockApi({ '/api/rarity-tiers': [], ...routes });
  renderWithProviders(
    <Routes>
      <Route path="/posts/:id" element={<PostDetailPage />} />
    </Routes>,
    { route: '/posts/p1' },
  );
  return fetchMock;
}
afterEach(() => vi.restoreAllMocks());

const detailGets = (f: ReturnType<typeof mockApi>) =>
  f.mock.calls.filter(([u, i]) => String(u) === '/api/posts/p1' && !i?.method).length;

describe('Finalize button visibility', () => {
  it('shows "Finalize time" to the poster of a recruiting post', async () => {
    renderPage({ '/api/posts/p1': post() });
    expect(await screen.findByRole('button', { name: 'Finalize time' })).toBeInTheDocument();
  });
  it('says "Change time" once the time is set', async () => {
    renderPage({ '/api/posts/p1': post({ scheduledAt: '2026-12-01T20:00:00Z' }) });
    expect(await screen.findByRole('button', { name: 'Change time' })).toBeInTheDocument();
  });
  it.each([
    ['non-poster', { isPoster: false }],
    ['LFP post', { type: 'lfp' as const }],
    ['closed post', { status: 'closed' as const }],
    ['deleted post', { deleted: true }],
  ])('no button for %s', async (_n, over) => {
    renderPage({ '/api/posts/p1': post(over) });
    await screen.findByRole('region', { name: 'When' });
    expect(screen.queryByRole('button', { name: /Finalize time|Change time/ })).toBeNull();
  });
});

describe('Finalize dialog', () => {
  const open = async (over: Partial<PostDetailDTO> = {}, routes: Record<string, unknown> = {}) => {
    const fetchMock = renderPage({ '/api/posts/p1': post(over), ...routes });
    const btn = await screen.findByRole('button', { name: /Finalize time|Change time/ });
    fireEvent.click(btn);
    return { fetchMock, btn };
  };

  it('can enable weekly reminders with the selected time zone', async () => {
    const put = vi.fn((_init?: RequestInit) => post());
    await open({}, { 'PUT /api/posts/p1/final-time': put });
    const repeat = screen.getByRole('checkbox', { name: 'Repeat weekly' });
    expect(repeat).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Final time'), { target: { value: '2026-11-20T19:30' } });
    fireEvent.click(repeat);
    expect(screen.getByText(/America\/New_York/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(put.mock.calls[0]?.[0]?.body))).toMatchObject({ repeatWeekly: true, timeZone: 'America/New_York' });
  });

  it('loads an existing weekly setting and lets the owner disable it', async () => {
    const put = vi.fn((_init?: RequestInit) => post());
    await open({ weeklyTimeZone: 'America/New_York', scheduledAt: '2026-11-20T00:30:00Z' }, { 'PUT /api/posts/p1/final-time': put });
    const repeat = screen.getByRole('checkbox', { name: 'Repeat weekly' });
    expect(repeat).toBeChecked();
    fireEvent.click(repeat);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(put.mock.calls[0]?.[0]?.body))).toMatchObject({ repeatWeekly: false });
  });

  it('limits the input to now through 30 days ahead, in local time at minute precision', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T15:00:30Z'));
    try {
      await open();
      const input = await screen.findByLabelText('Final time');
      expect(input).toHaveAttribute('min', utcIsoToLocalInput('2026-11-10T15:00:30Z'));
      expect(input).toHaveAttribute('max', utcIsoToLocalInput('2026-12-10T15:00:30Z'));
      expect(input.getAttribute('min')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefills from scheduledAt', async () => {
    await open({ scheduledAt: '2026-12-01T20:00:00Z' });
    expect(await screen.findByLabelText('Final time')).toHaveValue(utcIsoToLocalInput('2026-12-01T20:00:00Z'));
  });

  it('Save PUTs the UTC ISO of the entered time, closes and refetches', async () => {
    const bodies: unknown[] = [];
    const { fetchMock } = await open(
      {},
      {
        'PUT /api/posts/p1/final-time': (init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)));
          return post();
        },
      },
    );
    fireEvent.change(await screen.findByLabelText('Final time'), { target: { value: '2026-12-01T20:00' } });
    const before = detailGets(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toEqual([{ scheduledAt: localInputToUtcIso('2026-12-01T20:00'), repeatWeekly: false }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(detailGets(fetchMock)).toBeGreaterThan(before));
  });

  it('a 400 VALIDATION keeps the dialog open with the message', async () => {
    const { fetchMock } = await open();
    const orig = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      init?.method === 'PUT'
        ? new Response(JSON.stringify({ error: { code: 'VALIDATION', message: 'bad' } }), { status: 400 })
        : orig(input, init),
    );
    fireEvent.change(await screen.findByLabelText('Final time'), { target: { value: '2026-12-01T20:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Some fields are invalid');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Escape closes without a request and focus returns only after unmount', async () => {
    const { fetchMock, btn } = await open();
    const dialog = await screen.findByRole('dialog');
    const calls: boolean[] = [];
    const orig = btn.focus.bind(btn);
    btn.focus = () => {
      calls.push(document.querySelector('dialog') !== null);
      orig();
    };
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls).toEqual([false]);
    expect(document.activeElement).toBe(btn);
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false);
  });

  it('Cancel closes the dialog', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('whenLabel', () => {
  it('gives the final time, "Free times" or "Flexible"', () => {
    expect(whenLabel({ scheduledAt: null, freeTimes: [3] })).toBe('Free times');
    expect(whenLabel({ scheduledAt: null, freeTimes: [] })).toBe('Flexible');
    expect(whenLabel({ scheduledAt: '2026-12-01T20:00:00Z', freeTimes: [3] })).not.toMatch(/Free times|Flexible/);
  });
});

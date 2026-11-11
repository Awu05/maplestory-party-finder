import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { BOARD_POLL_MS, freeAtInstant, usePosts } from '../src/api/postHooks';
import { testQueryClient } from './setup';

afterEach(() => vi.useRealTimers());

it.each(['poll', 'focus', 'visibility'] as const)('refreshes the availability occurrence on %s despite unchanged results', async (trigger) => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-11-09T15:00:00Z'));
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('[]', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const client = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const filters = { freeAt: 96 };
  const hook = renderHook(() => { const { data } = usePosts(filters); return data; }, { wrapper });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  const first = String(fetch.mock.calls[0]![0]);
  vi.setSystemTime(new Date('2026-11-16T15:00:00Z'));
  await act(async () => {
    if (trigger === 'poll') vi.advanceTimersByTime(BOARD_POLL_MS);
    else if (trigger === 'focus') window.dispatchEvent(new Event('focus'));
    else document.dispatchEvent(new Event('visibilitychange'));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  const last = String(fetch.mock.calls.at(-1)![0]);
  expect(last).not.toBe(first);
  expect(new URL(last, 'https://test').searchParams.get('freeAt')).toBe(freeAtInstant(filters.freeAt));
  const cacheKey = client.getQueryCache().findAll().find(query => query.queryKey[3] === freeAtInstant(filters.freeAt))?.queryKey;
  expect(cacheKey).toBeDefined();
  hook.unmount();
  client.clear();
});

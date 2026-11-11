import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePost } from '../src/api/postHooks';
import { mockApi, testQueryClient } from './setup';

afterEach(() => vi.useRealTimers());

it('refreshes a viewed post so other members’ availability updates appear', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let note = 'before';
  const fetch = mockApi({ '/api/posts/p1': () => ({ note }) });
  const client = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => usePost('p1', { live: true }), { wrapper });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(result.current.data?.note).toBe('before');
  note = 'after';
  await act(async () => {
    vi.advanceTimersByTime(15_000);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(result.current.data?.note).toBe('after');
  expect(fetch.mock.calls.filter(([url]) => url === '/api/posts/p1').length).toBeGreaterThanOrEqual(2);
});

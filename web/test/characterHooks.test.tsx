import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useDeleteCharacter, useRefreshCharacter, useUpdateCharacter } from '../src/api/hooks';
import { mockApi, testQueryClient } from './setup';

// Posts embed character cards and close when their character is deleted.
describe('character mutations refresh posts', () => {
  function setup() {
    mockApi({ 'PATCH /api/characters/c1': {}, 'DELETE /api/characters/c1': undefined, 'POST /api/characters/c1/refresh': {} });
    const client = testQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const invalidated = () =>
      waitFor(() => {
        expect(spy).toHaveBeenCalledWith({ queryKey: ['characters'] });
        expect(spy).toHaveBeenCalledWith({ queryKey: ['posts'] });
      });
    return { wrapper, invalidated };
  }

  it('update', async () => {
    const { wrapper, invalidated } = setup();
    const { result } = renderHook(() => useUpdateCharacter('c1'), { wrapper });
    act(() => result.current.mutate({ note: 'x' }));
    await invalidated();
  });

  it('delete', async () => {
    const { wrapper, invalidated } = setup();
    const { result } = renderHook(() => useDeleteCharacter(), { wrapper });
    act(() => result.current.mutate('c1'));
    await invalidated();
  });

  it('refresh', async () => {
    const { wrapper, invalidated } = setup();
    const { result } = renderHook(() => useRefreshCharacter('c1'), { wrapper });
    act(() => result.current.mutate());
    await invalidated();
  });
});

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationListDTO } from '@pf/shared';
import { api } from './client';
import { useMe } from './hooks';

export const NOTIFICATION_POLL_MS = 30_000;

export function useNotifications() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationListDTO>('/api/notifications?limit=30'),
    enabled: !!me,
    refetchInterval: NOTIFICATION_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[] } | { all: true }) =>
      api<void>('/api/notifications/read', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

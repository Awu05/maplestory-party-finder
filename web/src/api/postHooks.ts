import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DAY_MS, nextOccurrence, SCHEDULED_GRACE_MS, type MyRequestsDTO, type PostDetailDTO, type PostSummaryDTO, type PostType, type RequestDTO } from '@pf/shared';
import { api } from './client';
import { useMe } from './hooks';
import { browserTimeZone } from '../lib/timeZone';

export interface PostFilters {
  type?: PostType;
  bossId?: number;
  bossDifficultyId?: number;
  guildId?: string;
  worldIds?: number[];
  when?: 'any' | '24h' | '7d' | 'flexible';
  /** Viewer-local hour-of-week (day * 24 + hour, 0 = Sunday): posts whose free times are shown in that cell. */
  freeAt?: number;
}

export function boardQueryString(f: PostFilters, now: Date = new Date()): string {
  const p = new URLSearchParams();
  if (f.type) p.set('type', f.type);
  if (f.bossId !== undefined) p.set('bossId', String(f.bossId));
  if (f.bossDifficultyId !== undefined) p.set('bossDifficultyId', String(f.bossDifficultyId));
  if (f.guildId) p.set('guildId', f.guildId);
  if (f.worldIds && f.worldIds.length > 0) p.set('worldIds', f.worldIds.join(','));
  if (f.when === '24h' || f.when === '7d') {
    // A run stays on the board for the grace period after its start, so include runs that just started.
    p.set('from', new Date(now.getTime() - SCHEDULED_GRACE_MS).toISOString());
    p.set('to', new Date(now.getTime() + (f.when === '24h' ? DAY_MS : 7 * DAY_MS)).toISOString());
  } else if (f.when === 'flexible') {
    p.set('flexible', '1');
  }
  if (f.freeAt !== undefined) p.set('freeAt', freeAtInstant(f.freeAt, now));
  return p.toString();
}

/**
 * The instant sent as `freeAt` for a viewer-local hour-of-week: the last minute of its next occurrence.
 * The grid rounds a poster hour down into the viewer cell holding its start, so in half-hour zones the
 * cell's end, not its start, falls in the poster hour shown there.
 */
export function freeAtInstant(hourOfWeek: number, now: Date = new Date()): string {
  const start = nextOccurrence(hourOfWeek, browserTimeZone(), now);
  return new Date(start.getTime() + 59 * 60_000).toISOString();
}

export function usePosts(filters: PostFilters, opts: { enabled?: boolean } = {}) {
  // The key holds the freeAt instant, not just the hour-of-week, so a cached result never answers for
  // an occurrence that has passed.
  // One clock read feeds both the key and the request, so they can't disagree at an hour boundary.
  const now = new Date();
  const freeAt = filters.freeAt !== undefined ? freeAtInstant(filters.freeAt, now) : undefined;
  return useQuery({
    queryKey: ['posts', 'board', filters, freeAt],
    queryFn: () => {
      const qs = boardQueryString(filters, now);
      return api<PostSummaryDTO[]>(qs ? `/api/posts?${qs}` : '/api/posts');
    },
    enabled: opts.enabled ?? true,
    // Keep the current rows while a filter change refetches, so focus and selection aren't lost to skeletons.
    placeholderData: keepPreviousData,
  });
}

export const usePost = (id: string | undefined) =>
  useQuery({ queryKey: ['posts', 'detail', id], queryFn: () => api<PostDetailDTO>(`/api/posts/${id}`), enabled: !!id });

function useInvalidatePosts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['posts'] });
}

export interface PostInput {
  type: PostType;
  characterId: string;
  bossDifficultyIds: number[];
  /** Local hour-of-week slots (day * 24 + hour, 0 = Sunday) in freeTimesZone. */
  freeTimes: number[];
  freeTimesZone: string | null;
  partySize?: number;
  minCp?: number;
  note: string;
}
export type UpdatePostInput = Partial<Omit<PostInput, 'minCp'>> & { minCp?: number | null };

export function useCreatePost() {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (input: PostInput) => api<PostDetailDTO>('/api/posts', { method: 'POST', json: input }),
    onSuccess: invalidate,
  });
}

export function useUpdatePost(id: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (input: UpdatePostInput) => api<PostDetailDTO>(`/api/posts/${id}`, { method: 'PATCH', json: input }),
    onSuccess: invalidate,
  });
}

export function useClosePost(id: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: () => api<PostDetailDTO>(`/api/posts/${id}/close`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useDeletePost(id: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: () => api<void>(`/api/posts/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useRenewPost(id: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: () => api<PostDetailDTO>(`/api/posts/${id}/renew`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useFinalizeTime(postId: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (scheduledAt: string) =>
      api<PostDetailDTO>(`/api/posts/${postId}/final-time`, { method: 'PUT', json: { scheduledAt } }),
    onSuccess: invalidate,
  });
}

export function useRequestJoin(postId: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (characterId: string) =>
      api<RequestDTO>(`/api/posts/${postId}/requests`, { method: 'POST', json: { characterId } }),
    onSuccess: invalidate,
  });
}

export function useInvite(lfpPostId: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (recruitingPostId: string) =>
      api<RequestDTO>(`/api/posts/${lfpPostId}/invites`, { method: 'POST', json: { recruitingPostId } }),
    onSuccess: invalidate,
  });
}

export function useAcceptRequest() {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (requestId: string) => api<PostDetailDTO>(`/api/requests/${requestId}/accept`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useDeclineRequest() {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (requestId: string) => api<RequestDTO>(`/api/requests/${requestId}/decline`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useCancelRequest() {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (requestId: string) => api<RequestDTO>(`/api/requests/${requestId}/cancel`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRemoveMember(postId: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (memberId: string) =>
      api<PostDetailDTO>(`/api/posts/${postId}/members/${memberId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useMyParties() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: ['posts', 'mine', 'parties'],
    queryFn: () => api<PostDetailDTO[]>('/api/me/parties'),
    enabled: !!me,
  });
}

export function useMyPosts() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: ['posts', 'mine', 'posts'],
    queryFn: () => api<PostSummaryDTO[]>('/api/me/posts'),
    enabled: !!me,
  });
}

export function useMyRequests() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: ['posts', 'mine', 'requests'],
    queryFn: () => api<MyRequestsDTO>('/api/me/requests'),
    enabled: !!me,
  });
}

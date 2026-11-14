import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiscordDestinationDTO, MyRequestsDTO, PostDetailDTO, PostSummaryDTO, PostType, RequestDTO } from '@pf/shared';
import { api } from './client';
import { useMe } from './hooks';

export interface PostFilters {
  type?: PostType;
  bossId?: number;
  bossDifficultyId?: number;
  worldIds?: number[];
}

function boardQueryString(f: PostFilters): string {
  const p = new URLSearchParams();
  if (f.type) p.set('type', f.type);
  if (f.bossId !== undefined) p.set('bossId', String(f.bossId));
  if (f.bossDifficultyId !== undefined) p.set('bossDifficultyId', String(f.bossDifficultyId));
  if (f.worldIds && f.worldIds.length > 0) p.set('worldIds', f.worldIds.join(','));
  return p.toString();
}

const BOARD_POLL_MS = 30_000;

export function usePosts(filters: PostFilters, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['posts', 'board', filters],
    queryFn: () => {
      const qs = boardQueryString(filters);
      return api<PostSummaryDTO[]>(qs ? `/api/posts?${qs}` : '/api/posts');
    },
    enabled: opts.enabled ?? true,
    // New posts appear without a reload: re-check every 30s, and as soon as the tab is looked at again.
    refetchInterval: BOARD_POLL_MS,
    refetchOnWindowFocus: true,
    // Keep the current rows while a filter change refetches, so focus and selection aren't lost to skeletons.
    placeholderData: keepPreviousData,
  });
}

export const usePost = (id: string | undefined, opts: { live?: boolean } = {}) =>
  useQuery({
    queryKey: ['posts', 'detail', id],
    queryFn: () => api<PostDetailDTO>(`/api/posts/${id}`),
    enabled: !!id,
    refetchInterval: opts.live ? 15_000 : false,
  });

function useInvalidatePosts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['posts'] });
}

export interface PostInput {
  notificationGuildId?: string | null;
  partyForumGuildId?: string | null;
  type: PostType;
  characterId: string;
  bossDifficultyIds: number[];
  /** Local half-hour slots (day * 48 + slot, 0 = Sunday) in freeTimesZone. */
  freeTimes: number[];
  freeTimesZone: string | null;
  partySize?: number;
  minCp?: number;
  /** Empty means the default Discord title (type: bosses). */
  title?: string;
  note: string;
}
export type UpdatePostInput = Partial<Omit<PostInput, 'minCp'>> & { minCp?: number | null };

export const useDiscordDestinations = () => useQuery({ queryKey: ['discord-destinations'], queryFn: () => api<DiscordDestinationDTO[]>('/api/discord-destinations'), staleTime: 60_000 });

export function useCreatePost() {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (input: PostInput) => api<PostDetailDTO>('/api/posts', { method: 'POST', headers: { 'X-Availability-Version': '2' }, json: input }),
    onSuccess: invalidate,
  });
}

export function useUpdatePost(id: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (input: UpdatePostInput) => api<PostDetailDTO>(`/api/posts/${id}`, { method: 'PATCH', headers: { 'X-Availability-Version': '2' }, json: input }),
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

export function useReopenPost(id: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: () => api<PostDetailDTO>(`/api/posts/${id}/reopen`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useAnnouncePost(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: () => api<PostDetailDTO>(`/api/posts/${id}/discord-announcement`, { method: 'POST' }),
    onSuccess: async (post) => {
      qc.setQueryData(['posts', 'detail', id], post);
      await invalidate();
    },
  });
}

export function useFinalizeTime(postId: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (input: { scheduledAt: string; repeatWeekly: boolean; timeZone?: string }) =>
      api<PostDetailDTO>(`/api/posts/${postId}/final-time`, { method: 'PUT', json: input }),
    onSuccess: invalidate,
  });
}

export function useMemberAvailability(postId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: ({ memberId, ...json }: { memberId: string; freeTimes: number[]; freeTimesZone: string | null }) =>
      api<PostDetailDTO>(`/api/posts/${postId}/members/${memberId}/free-times`, { method: 'PUT', json }),
    onSuccess: async (post) => {
      qc.setQueryData(['posts', 'detail', postId], post);
      await invalidate();
    },
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

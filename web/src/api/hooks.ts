import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminGuildDTO,
  AdminPostDTO,
  AdminUserDTO,
  BossDTO,
  CharacterDTO,
  GuildDTO,
  MeDTO,
  NexonCharacterPreview,
  RarityTierDTO,
  WebhookHealthDTO,
  WorldDTO,
} from '@pf/shared';
import { api } from './client';

const FIVE_MIN = 5 * 60 * 1000;

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<MeDTO>('/api/auth/me'), staleTime: FIVE_MIN });
}

export const useWorlds = () =>
  useQuery({ queryKey: ['worlds'], queryFn: () => api<WorldDTO[]>('/api/worlds'), staleTime: FIVE_MIN });
export const useGuilds = () =>
  useQuery({ queryKey: ['guilds'], queryFn: () => api<GuildDTO[]>('/api/guilds'), staleTime: FIVE_MIN });
export const useBosses = () =>
  useQuery({ queryKey: ['bosses'], queryFn: () => api<BossDTO[]>('/api/bosses'), staleTime: FIVE_MIN });
export const useRarityTiers = () =>
  useQuery({
    queryKey: ['rarity-tiers'],
    queryFn: () => api<RarityTierDTO[]>('/api/rarity-tiers'),
    staleTime: FIVE_MIN,
  });

export interface CharacterFilters {
  guildId?: string;
  worldId?: number;
  archetype?: string;
  q?: string;
  mine?: boolean;
}

export function useCharacters(filters: CharacterFilters = {}, opts: { enabled?: boolean } = {}) {
  const params = new URLSearchParams();
  if (filters.guildId) params.set('guildId', filters.guildId);
  if (filters.worldId !== undefined) params.set('worldId', String(filters.worldId));
  if (filters.archetype) params.set('archetype', filters.archetype);
  if (filters.q) params.set('q', filters.q);
  if (filters.mine) params.set('mine', '1');
  const qs = params.toString();
  return useQuery({
    queryKey: ['characters', 'list', filters],
    queryFn: () => api<CharacterDTO[]>(qs ? `/api/characters?${qs}` : '/api/characters'),
    enabled: opts.enabled ?? true,
  });
}

export function useCharacter(id: string | undefined) {
  return useQuery({
    queryKey: ['characters', 'detail', id],
    queryFn: () => api<CharacterDTO>(`/api/characters/${id}`),
    enabled: !!id,
  });
}

export interface CreateCharacterInput {
  ign: string;
  nexonWorldId: number;
  combatPower: number;
  guildId: string;
  bosses: { bossDifficultyId: number; experience: 'learning' | 'cleared' | 'can_carry' }[];
  playTimes: number[];
  note: string;
}
export type UpdateCharacterInput = Partial<Omit<CreateCharacterInput, 'ign' | 'nexonWorldId'>>;

function useInvalidateCharacters() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['characters'] });
}

/** Characters plus posts, which embed character cards and close when their poster's character is deleted. */
function useInvalidateCharactersAndPosts() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['characters'] }), qc.invalidateQueries({ queryKey: ['posts'] })]);
}

export function useCreateCharacter() {
  const invalidate = useInvalidateCharacters();
  return useMutation({
    mutationFn: (input: CreateCharacterInput) => api<CharacterDTO>('/api/characters', { method: 'POST', json: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateCharacter(id: string) {
  const invalidate = useInvalidateCharactersAndPosts();
  return useMutation({
    mutationFn: (input: UpdateCharacterInput) =>
      api<CharacterDTO>(`/api/characters/${id}`, { method: 'PATCH', json: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteCharacter() {
  const invalidate = useInvalidateCharactersAndPosts();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/characters/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function uploadScreenshot(id: string, file: File) {
  const body = new FormData();
  body.append('file', file);
  return api<CharacterDTO>(`/api/characters/${id}/screenshot`, { method: 'PUT', body });
}

export function useUploadScreenshot(id: string) {
  const invalidate = useInvalidateCharacters();
  return useMutation({
    mutationFn: (file: File) => uploadScreenshot(id, file),
    onSuccess: invalidate,
  });
}

export function useLookupCharacter() {
  return useMutation({
    mutationFn: (ign: string) =>
      api<NexonCharacterPreview[]>('/api/characters/lookup', { method: 'POST', json: { ign } }),
  });
}

export function useRefreshCharacter(id: string) {
  const invalidate = useInvalidateCharactersAndPosts();
  return useMutation({
    mutationFn: () => api<CharacterDTO>(`/api/characters/${id}/refresh`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

// ---- Admin ----

export const useAdminGuilds = () =>
  useQuery({ queryKey: ['admin', 'guilds'], queryFn: () => api<AdminGuildDTO[]>('/api/admin/guilds') });
export const useAdminWorlds = () =>
  useQuery({ queryKey: ['admin', 'worlds'], queryFn: () => api<WorldDTO[]>('/api/worlds?all=1') });

/** Runs an admin mutation, then refreshes admin lists, the public catalog and character lists (cards embed guild/world). */
function useAdminMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all(
        (['admin', 'guilds', 'worlds', 'bosses', 'rarity-tiers', 'characters'] as const).map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      ),
  });
}

export interface GuildInput {
  name?: string;
  iconUrl?: string | null;
  webhookUrl?: string | null;
  active?: boolean;
  worldIds?: number[];
}
export const useCreateGuild = () =>
  useAdminMutation((input: GuildInput) => api<AdminGuildDTO>('/api/admin/guilds', { method: 'POST', json: input }));
export const useUpdateGuild = () =>
  useAdminMutation(({ id, ...json }: GuildInput & { id: string }) =>
    api<AdminGuildDTO>(`/api/admin/guilds/${id}`, { method: 'PATCH', json }),
  );

export interface WorldInput {
  name?: string;
  worldType?: WorldDTO['worldType'];
  active?: boolean;
}
export const useCreateWorld = () =>
  useAdminMutation((input: WorldInput & { nexonWorldId: number }) =>
    api<WorldDTO>('/api/admin/worlds', { method: 'POST', json: input }),
  );
export const useUpdateWorld = () =>
  useAdminMutation(({ id, ...json }: WorldInput & { id: number }) =>
    api<WorldDTO>(`/api/admin/worlds/${id}`, { method: 'PATCH', json }),
  );

export interface BossInput {
  name?: string;
  difficulties?: { difficulty: string; partyCap: number; sortOrder: number }[];
}
export const useCreateBoss = () =>
  useAdminMutation((input: BossInput) => api<BossDTO>('/api/admin/bosses', { method: 'POST', json: input }));
export const useUpdateBoss = () =>
  useAdminMutation(({ id, ...json }: BossInput & { id: number }) =>
    api<BossDTO>(`/api/admin/bosses/${id}`, { method: 'PATCH', json }),
  );
export const useDeleteBoss = () =>
  useAdminMutation((id: number) => api<void>(`/api/admin/bosses/${id}`, { method: 'DELETE' }));

export const useSaveTiers = () =>
  useAdminMutation((tiers: { name: string; minCp: number; sortOrder: number }[]) =>
    api<RarityTierDTO[]>('/api/admin/rarity-tiers', { method: 'PUT', json: { tiers } }),
  );

export const useWebhookHealth = () =>
  useQuery({
    queryKey: ['admin', 'webhooks', 'health'],
    queryFn: () => api<WebhookHealthDTO[]>('/api/admin/webhooks/health'),
    refetchInterval: 60_000,
  });

export type TestWebhookResult = { ok: true } | { ok: false; error: string };
export function useTestWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (guildId: string) =>
      api<TestWebhookResult>(`/api/admin/guilds/${guildId}/test-webhook`, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'webhooks', 'health'] }),
  });
}

// ---- Admin moderation ----

export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function useAdminUsers(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ['admin', 'users', term],
    queryFn: () =>
      api<AdminUserDTO[]>(term ? `/api/admin/users?q=${encodeURIComponent(term)}` : '/api/admin/users'),
  });
}

export function useAdminUserCharacters(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'user-characters', userId],
    queryFn: () => api<CharacterDTO[]>(`/api/admin/users/${userId}/characters`),
    enabled,
  });
}

export function useAdminPosts(status: string, q: string) {
  const term = q.trim();
  const params = new URLSearchParams({ status });
  if (term) params.set('q', term);
  return useQuery({
    queryKey: ['admin', 'posts', status, term],
    queryFn: () => api<AdminPostDTO[]>(`/api/admin/posts?${params.toString()}`),
  });
}

/** Moderation changes users, characters and posts (bans close posts; deletes cascade), so refresh all three. */
function useModerationMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all(['admin', 'characters', 'posts'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
}

export const useSetBanned = () =>
  useModerationMutation(({ id, banned }: { id: string; banned: boolean }) =>
    api<AdminUserDTO>(`/api/admin/users/${id}`, { method: 'PATCH', json: { banned } }),
  );
export const useReassignCharacter = () =>
  useModerationMutation(({ id, userId }: { id: string; userId: string }) =>
    api<CharacterDTO>(`/api/admin/characters/${id}/reassign`, { method: 'POST', json: { userId } }),
  );
export const useAdminDeleteCharacter = () =>
  useModerationMutation((id: string) => api<void>(`/api/admin/characters/${id}`, { method: 'DELETE' }));
export const useAdminDeletePost = () =>
  useModerationMutation((id: string) => api<void>(`/api/admin/posts/${id}`, { method: 'DELETE' }));

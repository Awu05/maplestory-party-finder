import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BossDTO, CharacterDTO, GuildDTO, MeDTO, RarityTierDTO, WorldDTO } from '@pf/shared';
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

export function useCharacters(filters: CharacterFilters = {}) {
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

export function useCreateCharacter() {
  const invalidate = useInvalidateCharacters();
  return useMutation({
    mutationFn: (input: CreateCharacterInput) => api<CharacterDTO>('/api/characters', { method: 'POST', json: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateCharacter(id: string) {
  const invalidate = useInvalidateCharacters();
  return useMutation({
    mutationFn: (input: UpdateCharacterInput) =>
      api<CharacterDTO>(`/api/characters/${id}`, { method: 'PATCH', json: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteCharacter() {
  const invalidate = useInvalidateCharacters();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/characters/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useUploadScreenshot(id: string) {
  const invalidate = useInvalidateCharacters();
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api<CharacterDTO>(`/api/characters/${id}/screenshot`, { method: 'PUT', body });
    },
    onSuccess: invalidate,
  });
}

export function useRefreshCharacter(id: string) {
  const invalidate = useInvalidateCharacters();
  return useMutation({
    mutationFn: () => api<CharacterDTO>(`/api/characters/${id}/refresh`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

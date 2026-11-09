export type ExperienceLevel = 'learning' | 'cleared' | 'can_carry';

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  learning: 'Learning',
  cleared: 'Cleared before',
  can_carry: 'Can teach/carry',
};

export interface CharacterDTO {
  id: string;
  ign: string;
  world: { id: number; name: string };
  jobName: string;
  level: number;
  imageUrl: string;
  combatPower: number;
  cpUpdatedAt: string;
  guild: { id: string; name: string; iconUrl: string | null };
  screenshotUrl: string | null;
  note: string;
  playTimes: number[];
  bosses: { bossDifficultyId: number; bossName: string; difficulty: string; experience: ExperienceLevel }[];
  owner: { discordUsername: string };
  isOwner: boolean;
  syncStatus: 'ok' | 'stale';
  lastSyncedAt: string;
}

export type NexonCharacterPreview = {
  ign: string;
  level: number;
  jobName: string;
  imageUrl: string;
  nexonWorldId: number;
  worldName: string | null;
};

export type GuildDTO = {
  id: string;
  name: string;
  iconUrl: string | null;
  worldIds: number[];
  active: boolean;
};

export type AdminGuildDTO = GuildDTO & { webhookUrl: string | null };

export type WorldDTO = {
  id: number;
  nexonWorldId: number;
  name: string;
  worldType: 'heroic' | 'interactive';
  active: boolean;
};

export type BossDTO = {
  id: number;
  name: string;
  imageUrl: string | null;
  difficulties: { id: number; difficulty: string; partyCap: number }[];
};

export type RarityTierDTO = { id: number; name: string; minCp: number; sortOrder: number };

export type MeDTO = { id: string; discordUsername: string; avatarUrl: string | null; isAdmin: boolean } | null;

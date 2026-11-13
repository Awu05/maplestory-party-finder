import type { Archetype, ClassCategory } from './archetype';
export interface CharacterDTO {
  id: string;
  ign: string;
  world: { id: number; name: string };
  jobName: string;
  archetype: Archetype;
  level: number;
  imageUrl: string;
  combatPower: number;
  cpUpdatedAt: string;
  guild: { id: string; name: string; iconUrl: string | null } | null;
  manual: boolean;
  screenshotUrl: string | null;
  /**
   * discordLinked: signed in with (or linked to) Discord. Otherwise discordUsername was typed at signup and is
   * unverified, and is '' when its real Discord owner claimed it (show "Discord name not set", never a blank).
   */
  owner: { discordUsername: string; displayName: string | null; discordLinked: boolean };
  isOwner: boolean;
  syncStatus: 'ok' | 'stale';
  lastSyncedAt: string;
}

export type RefreshOutcome = 'synced' | 'stale' | 'not_found' | 'unavailable' | 'found_elsewhere';

export type WorldCandidateDTO = { worldId: number; worldName: string; level: number; jobName: string; imageUrl: string };

export type RefreshResultDTO = { outcome: RefreshOutcome; character: CharacterDTO; candidates: WorldCandidateDTO[] };

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

export type AdminGuildDTO = GuildDTO & { webhookUrl: string | null; partyForumWebhookUrl?: string | null; bossRoleIds: Record<string, string> };

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

/** discordUsername is '' for an unlinked account whose typed name was claimed by its real Discord owner. */
export type MeDTO = { id: string; discordUsername: string; displayName: string | null; avatarUrl: string | null; isAdmin: boolean; discordLinked?: boolean } | null;

export type PostType = 'lfp' | 'recruiting' | 'carrying';
export type PostStatus = 'open' | 'full' | 'closed';
export type RequestKind = 'join_request' | 'invite';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export const POST_TYPE_LABELS: Record<PostType, string> = { lfp: 'Looking for party', recruiting: 'Recruiting', carrying: 'Carrying' };

export interface PostBossDTO { bossDifficultyId: number; bossName: string; difficulty: string }

export interface MemberSnapshot { ign: string; jobName: string; level: number; imageUrl: string; worldName: string; guildName: string }

export interface PartyMemberDTO {
  id: string; role: 'poster' | 'member'; characterId: string | null;
  cpAtJoin: number; joinedAt: string;
  character: CharacterDTO | null; // null once the character is deleted
  snapshot: MemberSnapshot;
  isMine: boolean;
  /** Member availability; the poster's availability comes from the post. */
  freeTimes: number[];
  freeTimesZone: string | null;
}

export interface PostSummaryDTO {
  id: string; type: PostType; world: { id: number; name: string }; guild: { id: string; name: string } | null;
  poster: PartyMemberDTO; bosses: PostBossDTO[];
  scheduledAt: string | null; expiresAt: string; createdAt: string;
  weeklyTimeZone: string | null;
  /** Local half-hour slots (day * 48 + slot, 0 = Sunday) in freeTimesZone; scheduledAt is the final time. */
  freeTimes: number[]; freeTimesZone: string | null;
  partySize: number | null; memberCount: number; minCp: number | null; note: string;
  status: PostStatus; // effective
  /** Recruitment is closed, but the scheduled party is still active. */
  recruitmentClosed?: boolean;
  deleted: boolean; isPoster: boolean;
}

export interface RequestDTO {
  id: string; kind: RequestKind; status: RequestStatus; postId: string; lfpPostId: string | null;
  character: CharacterDTO; createdAt: string; decidedAt: string | null;
}

export interface PostDetailDTO extends PostSummaryDTO {
  notificationGuild?: { id: string; name: string } | null;
  partyForumGuild?: { id: string; name: string } | null;
  partyChatRequested?: boolean;
  members: PartyMemberDTO[]; // poster first, then by joinedAt
  isMember: boolean;
  incomingRequests: RequestDTO[]; // poster only: pending join requests
  sentInvites: RequestDTO[]; // poster only: pending invites from this recruiting post
  myPending: RequestDTO[]; // viewer's own pending join requests/invites involving this post
  receivedInvites: RequestWithPostDTO[]; // LFP post only: pending invites answering it, to the viewer's characters
  sentInvitesToThis: RequestWithPostDTO[]; // LFP post only: pending invites answering it that the viewer sent
  canRenew: boolean; // poster only: flexible, not closed or deleted (expired still renews)
  /** Earliest time the owner can request another Discord announcement. */
  discordAnnouncementAvailableAt?: string | null;
}

export interface RequestWithPostDTO extends RequestDTO { post: PostSummaryDTO }

export interface MyRequestsDTO { incomingInvites: RequestWithPostDTO[]; outgoingRequests: RequestWithPostDTO[] }

export interface NotificationDTO { id: string; kind: string; text: string; link: string; createdAt: string; read: boolean }
export interface NotificationListDTO { items: NotificationDTO[]; unreadCount: number }
export interface WebhookFailureDTO { id: string; eventType: string; attempts: number; lastError: string | null; createdAt: string }
export interface WebhookHealthDTO {
  guildId: string; guildName: string; hasWebhook: boolean; active: boolean;
  lastSentAt: string | null; pending: number; failedLast24h: number; recentFailures: WebhookFailureDTO[]; // <= 10
}
export interface AdminUserDTO { id: string; discordUsername: string; displayName: string | null; avatarUrl: string | null; banned: boolean; deletedAt: string | null; isAdmin: boolean; createdAt: string; characterCount: number; discordLinked: boolean }
export interface AdminPostDTO extends PostSummaryDTO { deletedAt: string | null; closedReason: string | null; posterDiscordUsername: string; posterDiscordLinked: boolean }

export type JobClassDTO = { id: number; name: string; archetype: Exclude<Archetype, 'unknown'>; category: ClassCategory };
export interface DiscordDestinationDTO { id: string; name: string; worldIds: number[]; notifications: boolean; partyForum: boolean }

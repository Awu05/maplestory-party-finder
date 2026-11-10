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

export type PostType = 'lfp' | 'recruiting';
export type PostStatus = 'open' | 'full' | 'closed';
export type RequestKind = 'join_request' | 'invite';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export const POST_TYPE_LABELS: Record<PostType, string> = { lfp: 'Looking for party', recruiting: 'Recruiting' };

export interface PostBossDTO { bossDifficultyId: number; bossName: string; difficulty: string }

export interface MemberSnapshot { ign: string; jobName: string; level: number; imageUrl: string; worldName: string; guildName: string }

export interface PartyMemberDTO {
  id: string; role: 'poster' | 'member'; characterId: string | null;
  cpAtJoin: number; joinedAt: string;
  character: CharacterDTO | null; // null once the character is deleted
  snapshot: MemberSnapshot;
  isMine: boolean;
}

export interface PostSummaryDTO {
  id: string; type: PostType; world: { id: number; name: string }; guild: { id: string; name: string };
  poster: PartyMemberDTO; bosses: PostBossDTO[];
  scheduledAt: string | null; expiresAt: string; createdAt: string;
  partySize: number | null; memberCount: number; minCp: number | null; note: string;
  status: PostStatus; // effective
  deleted: boolean; isPoster: boolean;
}

export interface RequestDTO {
  id: string; kind: RequestKind; status: RequestStatus; postId: string; lfpPostId: string | null;
  character: CharacterDTO; createdAt: string; decidedAt: string | null;
}

export interface PostDetailDTO extends PostSummaryDTO {
  members: PartyMemberDTO[]; // poster first, then by joinedAt
  isMember: boolean;
  incomingRequests: RequestDTO[]; // poster only: pending join requests
  sentInvites: RequestDTO[]; // poster only: pending invites from this recruiting post
  myPending: RequestDTO[]; // viewer's own pending join requests/invites involving this post
  receivedInvites: RequestWithPostDTO[]; // LFP post only: pending invites answering it, to the viewer's characters
  sentInvitesToThis: RequestWithPostDTO[]; // LFP post only: pending invites answering it that the viewer sent
  canRenew: boolean; // poster only: flexible, not closed or deleted (expired still renews)
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
export interface AdminUserDTO { id: string; discordUsername: string; avatarUrl: string | null; banned: boolean; isAdmin: boolean; createdAt: string; characterCount: number }
export interface AdminPostDTO extends PostSummaryDTO { deletedAt: string | null; closedReason: string | null; posterDiscordUsername: string }

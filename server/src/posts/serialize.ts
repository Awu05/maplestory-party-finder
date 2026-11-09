import type { Prisma } from '@prisma/client';
import { effectivePostStatus, type PartyMemberDTO, type PostBossDTO, type PostDetailDTO, type PostSummaryDTO } from '@pf/shared';
import type { Viewer } from '../auth/guards.js';
import { characterInclude, toCharacterDTO } from '../characters/serialize.js';
import { requestInclude, toRequestDTO } from '../requests/serialize.js';
import type { Storage } from '../storage/storage.js';
import { parseSnapshot } from './snapshot.js';

export const postSummaryInclude = {
  world: true,
  // Only public fields: never the guild webhookUrl.
  guild: { select: { id: true, name: true } },
  bosses: { include: { bossDifficulty: { include: { boss: true } } } },
  members: { include: { character: { include: characterInclude } }, orderBy: { joinedAt: 'asc' } },
} satisfies Prisma.PostInclude;

export const postInclude = {
  ...postSummaryInclude,
  // Pending only; the detail serializer decides who may see which.
  requests: { where: { status: 'pending' }, include: requestInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.PostInclude;

export type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;
/** A post loaded without its pending requests; every PostRow is also a PostSummaryRow. */
export type PostSummaryRow = Prisma.PostGetPayload<{ include: typeof postSummaryInclude }>;
type MemberRow = PostSummaryRow['members'][number];

export function toMemberDTO(m: MemberRow, viewerUserId: string | null, storage: Storage): PartyMemberDTO {
  return {
    id: m.id,
    role: m.role,
    characterId: m.characterId,
    cpAtJoin: Number(m.cpAtJoin),
    joinedAt: m.joinedAt.toISOString(),
    character: m.character ? toCharacterDTO(m.character, viewerUserId, storage) : null,
    snapshot: parseSnapshot(m.snapshot),
    isMine: viewerUserId !== null && m.userId === viewerUserId,
  };
}

function toBossDTOs(row: PostSummaryRow): PostBossDTO[] {
  return [...row.bosses]
    .sort(
      (a, b) =>
        a.bossDifficulty.boss.sortOrder - b.bossDifficulty.boss.sortOrder ||
        a.bossDifficulty.boss.id - b.bossDifficulty.boss.id ||
        a.bossDifficulty.sortOrder - b.bossDifficulty.sortOrder ||
        a.bossDifficulty.id - b.bossDifficulty.id,
    )
    .map((b) => ({
      bossDifficultyId: b.bossDifficultyId,
      bossName: b.bossDifficulty.boss.name,
      difficulty: b.bossDifficulty.difficulty,
    }));
}

export function toPostSummaryDTO(row: PostSummaryRow, viewerUserId: string | null, storage: Storage, now: Date): PostSummaryDTO {
  const poster = row.members.find((m) => m.role === 'poster');
  if (!poster) throw new Error(`Post ${row.id} has no poster member`);
  return {
    id: row.id,
    type: row.type,
    world: { id: row.world.id, name: row.world.name },
    guild: { id: row.guild.id, name: row.guild.name },
    poster: toMemberDTO(poster, viewerUserId, storage),
    bosses: toBossDTOs(row),
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    partySize: row.partySize,
    memberCount: row.members.length,
    minCp: row.minCp === null ? null : Number(row.minCp),
    note: row.note,
    status: effectivePostStatus(row, now),
    deleted: row.deletedAt !== null,
    isPoster: viewerUserId !== null && row.posterUserId === viewerUserId,
  };
}

export function toPostDetailDTO(row: PostRow, viewer: Viewer | null, storage: Storage, now: Date): PostDetailDTO {
  const viewerUserId = viewer?.user.id ?? null;
  const isPoster = viewerUserId !== null && row.posterUserId === viewerUserId;
  const requestDTOs = (kind: 'join_request' | 'invite') =>
    isPoster ? row.requests.filter((r) => r.kind === kind).map((r) => toRequestDTO(r, viewerUserId, storage)) : [];
  const members = [...row.members].sort(
    (a, b) => Number(b.role === 'poster') - Number(a.role === 'poster') || a.joinedAt.getTime() - b.joinedAt.getTime(),
  );
  return {
    ...toPostSummaryDTO(row, viewerUserId, storage, now),
    members: members.map((m) => toMemberDTO(m, viewerUserId, storage)),
    isMember: viewerUserId !== null && row.members.some((m) => m.userId === viewerUserId),
    incomingRequests: requestDTOs('join_request'),
    sentInvites: requestDTOs('invite'),
    myPending:
      viewerUserId === null
        ? []
        : row.requests.filter((r) => r.character.ownerId === viewerUserId).map((r) => toRequestDTO(r, viewerUserId, storage)),
  };
}

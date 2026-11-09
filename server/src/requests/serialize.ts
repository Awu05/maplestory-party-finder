import type { Prisma } from '@prisma/client';
import type { RequestDTO } from '@pf/shared';
import { characterInclude, toCharacterDTO } from '../characters/serialize.js';
import type { Storage } from '../storage/storage.js';

export const requestInclude = { character: { include: characterInclude } } satisfies Prisma.RequestInclude;

export type RequestRow = Prisma.RequestGetPayload<{ include: typeof requestInclude }>;

export function toRequestDTO(row: RequestRow, viewerUserId: string | null, storage: Storage): RequestDTO {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    postId: row.postId,
    lfpPostId: row.lfpPostId,
    character: toCharacterDTO(row.character, viewerUserId, storage),
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

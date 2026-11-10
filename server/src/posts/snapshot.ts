import { z } from 'zod';
import type { MemberSnapshot } from '@pf/shared';
import type { CharacterRow } from '../characters/serialize.js';

const snapshotSchema = z.object({
  ign: z.string(),
  jobName: z.string(),
  level: z.number(),
  imageUrl: z.string(),
  worldName: z.string(),
  guildName: z.string(),
});

/** What a PostMember keeps of a character, so a party survives the character being deleted. */
export function memberSnapshot(row: CharacterRow): MemberSnapshot {
  return {
    ign: row.ign,
    jobName: row.jobName,
    level: row.level,
    imageUrl: row.imageUrl,
    worldName: row.world.name,
    guildName: row.guild?.name ?? 'No guild',
  };
}

/** Validates the Json column when reading it back. */
export function parseSnapshot(json: unknown): MemberSnapshot {
  return snapshotSchema.parse(json);
}

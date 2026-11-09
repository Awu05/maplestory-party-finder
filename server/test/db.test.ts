import { beforeEach, describe, expect, it } from 'vitest';
import { makeCharacter, resetDb } from './helpers.js';

describe('database', () => {
  beforeEach(resetDb);

  it('rejects a second character with the same ignLower and world', async () => {
    const first = await makeCharacter({ ign: 'Lily', ignLower: 'lily' });
    await expect(
      makeCharacter({ ign: 'lily', ignLower: 'lily', worldId: first.worldId, ownerId: first.ownerId, guildId: first.guildId }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

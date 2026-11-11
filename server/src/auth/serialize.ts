import type { MeDTO } from '@pf/shared';
import type { Viewer } from './guards.js';

export function toMeDTO({ user, isAdmin }: Viewer): NonNullable<MeDTO> {
  return {
    id: user.id, discordUsername: user.username, displayName: user.displayName,
    avatarUrl: user.avatar, isAdmin, discordLinked: user.discordId !== null,
  };
}

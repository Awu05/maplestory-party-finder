import { ApiError } from './client';

const FRIENDLY: Record<string, string> = {
  VALIDATION: 'Some fields are invalid. Check the values and try again.',
  DUPLICATE: 'That already exists.',
  IN_USE: 'Still in use by characters, so it cannot be removed.',
  NEEDS_BASE_TIER: 'Add a base tier with Min CP 0.',
  NOT_FOUND: 'That no longer exists. Refresh and try again.',
  ALREADY_CLAIMED: "This character is already claimed. Contact the admin if it's yours.",
  NEXON_UNAVAILABLE: "Couldn't reach Nexon. Try again in a minute.",
  TOO_SOON: 'Refreshed recently. Try again in a few minutes.',
  UNAUTHENTICATED: 'Your session expired — log in again.',
  BANNED: 'Your account has been banned. Contact the admin.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_OWNER: "You don't own this character.",
  GUILD_INACTIVE: "That guild isn't accepting characters right now.",
  WORLD_INACTIVE: "That world isn't active right now.",
};

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) return FRIENDLY[err.code] ?? err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

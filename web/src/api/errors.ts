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
  WRONG_WORLD: "That character isn't on this post's world.",
  NOT_ALLOWED: "You can't do that.",
  POST_CLOSED: 'This post is closed.',
  POST_FULL: 'This party is already full.',
  ALREADY_MEMBER: 'That character is already in the party.',
  ALREADY_PENDING: 'There is already a pending request for that character.',
  NOT_PENDING: 'That request has already been handled.',
  CANNOT_LEAVE_OWN_POST: "You can't leave your own post. Close or delete it instead.",
  NOT_FLEXIBLE: 'Only flexible posts can be renewed.',
  PARTY_TOO_SMALL: "Party size can't be smaller than the current number of members.",
  HAS_MEMBERS: 'Others have already joined, so this can no longer be changed.',
  NO_WEBHOOK: 'This guild has no webhook set.',
  WRONG_POST_TYPE: "That isn't allowed for this type of post.",
};

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) return FRIENDLY[err.code] ?? err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}

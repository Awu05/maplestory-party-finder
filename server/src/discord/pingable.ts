type PingUser = { discordId: string | null; typedDiscordId: string | null; banned?: boolean; deletedAt?: Date | null };

/**
 * The ID to mention a user by: the linked (verified) ID, else the typed one. Null for banned or
 * deleted accounts, so every ping path agrees. Message builders check the ID's format.
 */
export function pingableId(user: PingUser): { id: string; verified: boolean } | null {
  if (user.banned || user.deletedAt) return null;
  const id = user.discordId ?? user.typedDiscordId;
  return id ? { id, verified: user.discordId !== null } : null;
}

/** A party thread roster entry: pinged when pingable, else listed by its typed Discord name. Removed accounts show only their character. */
export function rosterMember(ign: string, user: (PingUser & { username: string }) | undefined): { ign: string; discordId: string | null; verified?: boolean; discordUsername?: string } {
  const ping = user ? pingableId(user) : null;
  const removed = !user || user.banned || user.deletedAt;
  return { ign, discordId: ping?.id ?? null, verified: ping?.verified, ...(removed ? {} : { discordUsername: user.username }) };
}

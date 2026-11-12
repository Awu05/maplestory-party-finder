/** Shown instead of an empty Discord username (a typed name claimed by its real Discord owner). */
export const DISCORD_NAME_NOT_SET = 'Discord name not set';

type Named = { discordUsername: string; displayName: string | null };

/** The name to show for an account: display name, else Discord username, else "Discord name not set". */
export const accountName = (a: Named): string => a.displayName || a.discordUsername || DISCORD_NAME_NOT_SET;

/** "@name" for a Discord-linked account, the typed name otherwise, or null when there is no name. */
export const discordHandle = (a: { discordUsername: string; discordLinked?: boolean }): string | null =>
  a.discordUsername ? (a.discordLinked === false ? a.discordUsername : `@${a.discordUsername}`) : null;

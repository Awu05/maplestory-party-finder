import { POST_TYPE_LABELS, formatCpShort } from '@pf/shared';
import type { PostBossDTO, PostSummaryDTO } from '@pf/shared';

export type WebhookPayload = {
  content?: string;
  embeds?: object[];
  allowed_mentions: { parse: string[]; users?: string[]; roles?: string[] };
  username?: string;
  thread_name?: string;
  _weekly?: { nextAt: string; anchorAt: string; timeZone: string };
};

const ZWSP = '​';
const NOTE_MAX = 300;
const FIELD_MAX = 1024;
const TITLE_MAX = 256;
const COLOR_RECRUITING = 0x3b82f6;
const COLOR_LFP = 0x22c55e;

/** Break up anything Discord would render as a mention. Applied to all user-supplied text. */
export function neutralize(text: string): string {
  return text
    .replace(/@everyone/g, `@${ZWSP}everyone`)
    .replace(/@here/g, `@${ZWSP}here`)
    .replace(/<@/g, `<@${ZWSP}`);
}

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max - 1) + '…' : s);

export const bossLabel = (b: PostBossDTO): string => `${b.difficulty} ${b.bossName}`;
const bossesLabel = (post: PostSummaryDTO): string => post.bosses.map(bossLabel).join(' + ');
const postLink = (post: PostSummaryDTO, webOrigin: string): string => `${webOrigin}/posts/${post.id}`;

export function discordTime(iso: string | null): string {
  if (!iso) return 'Flexible';
  const t = Math.floor(Date.parse(iso) / 1000);
  return `<t:${t}:F> (<t:${t}:R>)`;
}

export function buildNewPostMessage(post: PostSummaryDTO, webOrigin: string, bossRoleIds: string[] = []): WebhookPayload {
  const roles = [...new Set(bossRoleIds.filter((id) => /^[1-9]\d{16,19}$/.test(id)))];
  const recruiting = post.type === 'recruiting';
  const snap = post.poster.snapshot;
  const field = (name: string, value: string) => ({ name, value: clip(neutralize(value), FIELD_MAX), inline: true });

  const when = post.scheduledAt
    ? discordTime(post.scheduledAt)
    : post.freeTimes.length > 0 ? 'Not set yet — see free times on the post' : 'Flexible';
  const fields = [field('World', post.world.name), field('When', when)];
  if (recruiting && post.partySize != null) fields.push(field('Slots', `${post.memberCount}/${post.partySize}`));
  if (post.minCp != null) fields.push(field('Min CP', formatCpShort(post.minCp)));
  fields.push(field('Poster', `${snap.ign} · ${snap.jobName} · Lv ${snap.level} · CP ${formatCpShort(post.poster.cpAtJoin)}`));
  fields.push(field('Guild', post.guild.name));
  const owner = post.poster.character?.owner;
  // Always include the real handle: a display name alone can't be searched on Discord and could copy someone else's.
  const discord = owner && (owner.displayName ? `${owner.displayName} (@${owner.discordUsername})` : owner.discordUsername);
  if (discord) fields.push(field('Discord', discord));
  const note = clip(neutralize(post.note.trim()), NOTE_MAX);
  if (note) fields.push({ name: 'Note', value: note, inline: false });

  return {
    ...(roles.length ? { content: roles.map((id) => `<@&${id}>`).join(' ') } : {}),
    embeds: [{
      title: clip(neutralize(`${POST_TYPE_LABELS[post.type]}: ${bossesLabel(post)}`), TITLE_MAX),
      url: postLink(post, webOrigin),
      color: recruiting ? COLOR_RECRUITING : COLOR_LFP,
      ...(/^https?:\/\//.test(snap.imageUrl) ? { thumbnail: { url: snap.imageUrl } } : {}),
      fields,
    }],
    allowed_mentions: { parse: [], ...(roles.length ? { roles } : {}) },
  };
}

export function buildRequestPing(args: {
  recipientDiscordId: string;
  kind: 'join_request' | 'invite';
  applicant: { ign: string; jobName: string; level: number; combatPower: number };
  post: PostSummaryDTO;
  webOrigin: string;
}): WebhookPayload {
  const { recipientDiscordId: id, kind, applicant, post } = args;
  const link = postLink(post, args.webOrigin);
  const bosses = neutralize(bossesLabel(post));
  const ign = neutralize(applicant.ign);
  const content = kind === 'join_request'
    ? `<@${id}> ${ign} (${neutralize(applicant.jobName)}, ${applicant.level}, CP ${formatCpShort(applicant.combatPower)}) wants to join your ${bosses} run → ${link}`
    : `<@${id}> ${neutralize(post.poster.snapshot.ign)} invited ${ign} to their ${bosses} run → ${link}`;
  return { content, allowed_mentions: { parse: [], users: [id] } };
}

export function buildAcceptPing(args: {
  recipientDiscordId: string;
  ign: string;
  post: PostSummaryDTO;
  webOrigin: string;
}): WebhookPayload {
  const { recipientDiscordId: id, ign, post } = args;
  return {
    content: `<@${id}> ${neutralize(ign)} was accepted into ${neutralize(post.poster.snapshot.ign)}'s ${neutralize(bossesLabel(post))} run → ${postLink(post, args.webOrigin)}`,
    allowed_mentions: { parse: [], users: [id] },
  };
}

export function buildTimeSetPing(args: {
  recipientDiscordId: string;
  posterIgn: string;
  post: PostSummaryDTO;
  scheduledAt: string;
  webOrigin: string;
}): WebhookPayload {
  const { recipientDiscordId: id, post } = args;
  const unix = Math.floor(Date.parse(args.scheduledAt) / 1000);
  return {
    content: `<@${id}> ${neutralize(args.posterIgn)} set the time for ${neutralize(bossesLabel(post))}: <t:${unix}:F> → ${postLink(post, args.webOrigin)}`,
    allowed_mentions: { parse: [], users: [id] },
  };
}

export function buildTestMessage(guildName: string): WebhookPayload {
  return { content: `✅ Party Finder is connected to ${neutralize(guildName)}.`, allowed_mentions: { parse: [] } };
}

/** Thread title and opening message for a finalized party. */
export function buildPartyThread(post: PostSummaryDTO, webOrigin: string, members: { ign: string; discordId: string }[] = []): { name: string; message: WebhookPayload } {
  const bosses = clip(neutralize(bossesLabel(post)), 700);
  const poster = clip(neutralize(post.poster.snapshot.ign), 100);
  const roster = members.filter((member) => /^[1-9]\d{16,19}$/.test(member.discordId))
    .map((member) => `• ${clip(neutralize(member.ign), 50)}: <@${member.discordId}> (\`${member.discordId}\`)`).join('\n');
  return {
    name: clip(`${bosses} — ${poster}`, 100),
    message: {
      content: `**${bosses}**\nHosted by ${poster} · ${clip(neutralize(post.world.name), 100)}\nTime: ${discordTime(post.scheduledAt)}\nMembers:\n${roster || 'No Discord IDs available'}\nParty details: ${postLink(post, webOrigin)}`,
      allowed_mentions: { parse: [] },
    },
  };
}

export function buildWeeklyReminder(args: {
  recipientDiscordIds: string[];
  post: PostSummaryDTO;
  webOrigin: string;
}): WebhookPayload {
  const users = [...new Set(args.recipientDiscordIds)];
  return {
    content: `${users.map((id) => `<@${id}>`).join(' ')} Weekly party reminder: ${neutralize(bossesLabel(args.post))} is starting now (${discordTime(args.post.scheduledAt)}) → ${postLink(args.post, args.webOrigin)}`,
    allowed_mentions: { parse: [], users },
  };
}

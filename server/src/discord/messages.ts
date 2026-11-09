import { POST_TYPE_LABELS, formatCpShort } from '@pf/shared';
import type { PostBossDTO, PostSummaryDTO } from '@pf/shared';

export type WebhookPayload = {
  content?: string;
  embeds?: object[];
  allowed_mentions: { parse: string[]; users?: string[] };
  username?: string;
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

export function buildNewPostMessage(post: PostSummaryDTO, webOrigin: string): WebhookPayload {
  const recruiting = post.type === 'recruiting';
  const snap = post.poster.snapshot;
  const field = (name: string, value: string) => ({ name, value: clip(neutralize(value), FIELD_MAX), inline: true });

  const fields = [field('World', post.world.name), field('When', discordTime(post.scheduledAt))];
  if (recruiting && post.partySize != null) fields.push(field('Slots', `${post.memberCount}/${post.partySize}`));
  if (post.minCp != null) fields.push(field('Min CP', formatCpShort(post.minCp)));
  fields.push(field('Poster', `${snap.ign} · ${snap.jobName} · Lv ${snap.level} · CP ${formatCpShort(post.poster.cpAtJoin)}`));
  fields.push(field('Guild', post.guild.name));
  const username = post.poster.character?.owner.discordUsername;
  if (username) fields.push(field('Discord', username));
  const note = clip(neutralize(post.note.trim()), NOTE_MAX);
  if (note) fields.push({ name: 'Note', value: note, inline: false });

  return {
    embeds: [{
      title: clip(neutralize(`${POST_TYPE_LABELS[post.type]}: ${bossesLabel(post)}`), TITLE_MAX),
      url: postLink(post, webOrigin),
      color: recruiting ? COLOR_RECRUITING : COLOR_LFP,
      thumbnail: { url: snap.imageUrl },
      fields,
    }],
    allowed_mentions: { parse: [] },
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

export function buildTestMessage(guildName: string): WebhookPayload {
  return { content: `✅ Party Finder is connected to ${neutralize(guildName)}.`, allowed_mentions: { parse: [] } };
}

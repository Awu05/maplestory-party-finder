import { describe, expect, it } from 'vitest';
import type { PostSummaryDTO } from '@pf/shared';
import {
  bossLabel, buildAcceptPing, buildNewPostMessage, buildPartyThread, buildPostClosedMessage, buildRequestPing, buildTestMessage, buildWeeklyReminder, discordTime, neutralize, weeklyReminderPost,
} from '../src/discord/messages';

const ZW = '​';
const ORIGIN = 'https://pf.example';

function makePost(over: Partial<PostSummaryDTO> = {}): PostSummaryDTO {
  return {
    id: 'p1', type: 'recruiting', world: { id: 1, name: 'Scania' }, guild: { id: 'g1', name: 'Maple Guild' },
    poster: {
      id: 'm1', role: 'poster', characterId: 'c1', cpAtJoin: 1_500_000_000, joinedAt: '2025-11-09T00:00:00Z',
      character: { owner: { discordUsername: 'alice', discordLinked: true } } as never,
      snapshot: { ign: 'Alice', jobName: 'Hero', level: 280, imageUrl: 'https://img/a.png', worldName: 'Scania', guildName: 'Maple Guild' },
      isMine: false,
    },
    bosses: [
      { bossDifficultyId: 1, bossName: 'Lucid', difficulty: 'Hard' },
      { bossDifficultyId: 2, bossName: 'Will', difficulty: 'Hard' },
    ],
    scheduledAt: '2025-11-10T20:00:00Z', expiresAt: '2025-11-11T00:00:00Z', createdAt: '2025-11-09T00:00:00Z',
    freeTimes: [], freeTimesZone: null,
    partySize: 4, memberCount: 2, minCp: 50_000_000, note: 'bring pots',
    status: 'open', deleted: false, isPoster: false,
    ...over,
  } as PostSummaryDTO;
}
const fields = (p: ReturnType<typeof buildNewPostMessage>) =>
  Object.fromEntries((p.embeds![0] as any).fields.map((f: any) => [f.name, f.value]));

describe('helpers', () => {
  it('lists unlinked accounts by their typed name, marked unverified, without allowing Discord mentions', () => {
    const thread = buildPartyThread(makePost(), ORIGIN, [{ ign: 'Local', discordId: null, discordUsername: '<@123456789012345678> @everyone' }]);
    expect(thread.message.content).toContain(`Local (Discord name, unverified: <@${ZW}123456789012345678> @${ZW}everyone)`);
    expect(thread.message.content).not.toContain('Discord: @');
    expect(thread.message.content).not.toContain('<@123456789012345678>');
    expect(thread.message.content).not.toContain('@everyone');
    expect(thread.message.allowed_mentions).toEqual({ parse: [] });
  });
  it('builds a safe, concise finalized party thread with time and link', () => {
    const post = makePost({ bosses: [{ bossDifficultyId: 1, bossName: '@everyone', difficulty: 'Hard' }] });
    const thread = buildPartyThread(post, ORIGIN, [{ ign: 'Alice', discordId: '123456789012345678' }, { ign: '@everyone', discordId: '234567890123456789' }, { ign: 'Invalid', discordId: 'bad-id' }]);
    expect(thread.name.length).toBeLessThanOrEqual(100);
    expect(thread.message.content).toContain('<t:1762804800:F>');
    expect(thread.message.content).toContain(`${ORIGIN}/posts/p1`);
    expect(thread.message.content).not.toContain('@everyone');
    expect(thread.message.content).toContain('Alice: <@123456789012345678> (`123456789012345678`)');
    expect(thread.message.content).toContain('<@234567890123456789>');
    expect(thread.message.content).not.toContain('bad-id');
    expect(thread.message.allowed_mentions).toEqual({ parse: [] });
  });
  it('bossLabel', () => expect(bossLabel(makePost().bosses[0])).toBe('Hard Lucid'));
  it('discordTime', () => {
    expect(discordTime('2025-11-10T20:00:00Z')).toBe('<t:1762804800:F> (<t:1762804800:R>)');
    expect(discordTime(null)).toBe('Flexible');
  });
  it('neutralize', () => {
    expect(neutralize('@everyone @here <@1>')).toBe(`@${ZW}everyone @${ZW}here <@${ZW}1>`);
  });
});

describe('buildNewPostMessage', () => {
  it('uses the display name and neutralizes mentions without changing ping recipients', () => {
    const post = makePost();
    post.poster.character!.owner.displayName = '@everyone Maple';
    expect(fields(buildNewPostMessage(post, ORIGIN)).Discord).toBe(`@${ZW}everyone Maple (@alice)`);
    const ping = buildAcceptPing({ recipientDiscordId: '123', ign: 'Alice', post, webOrigin: ORIGIN });
    expect(ping.content).toContain('<@123>');
    expect(ping.allowed_mentions).toEqual({ parse: [], users: ['123'] });
  });
  it('treats a post stored before accounts could be unlinked (no discordLinked field) as Discord-linked', () => {
    const post = makePost();
    // Messages queued by an older version carry no discordLinked; every account was a Discord account then.
    delete (post.poster.character!.owner as { discordLinked?: boolean }).discordLinked;
    expect(fields(buildNewPostMessage(post, ORIGIN)).Discord).toBe('alice');
    post.poster.character!.owner.displayName = 'Maple';
    expect(fields(buildNewPostMessage(post, ORIGIN)).Discord).toBe('Maple (@alice)');
  });

  it('marks a typed Discord name from a password or passkey account as unverified, without an @', () => {
    const post = makePost();
    post.poster.character!.owner = { discordUsername: '@everyone', displayName: null, discordLinked: false };
    expect(fields(buildNewPostMessage(post, ORIGIN)).Discord).toBe(`Discord name, unverified: @${ZW}everyone`);
    post.poster.character!.owner = { discordUsername: 'alice', displayName: 'Maple', discordLinked: false };
    expect(fields(buildNewPostMessage(post, ORIGIN)).Discord).toBe('Maple (Discord name, unverified: alice)');
  });
  it('prints no empty unverified Discord name (a name claimed by its real owner)', () => {
    const post = makePost();
    post.poster.character!.owner = { discordUsername: '', displayName: null, discordLinked: false };
    expect(fields(buildNewPostMessage(post, ORIGIN))).not.toHaveProperty('Discord');
    post.poster.character!.owner = { discordUsername: '', displayName: 'Maple', discordLinked: false };
    expect(fields(buildNewPostMessage(post, ORIGIN)).Discord).toBe('Maple');
    const thread = buildPartyThread(makePost(), ORIGIN, [{ ign: 'Local', discordId: null, discordUsername: '' }]);
    expect(thread.message.content).toContain('• Local\n');
    expect(thread.message.content).not.toContain('unverified');
  });
  it('omits the thumbnail when the snapshot image url is empty or relative', () => {
    for (const imageUrl of ['', '/uploads/a.png']) {
      const post = makePost();
      post.poster.snapshot.imageUrl = imageUrl;
      const e = buildNewPostMessage(post, ORIGIN).embeds![0] as any;
      expect(e).not.toHaveProperty('thumbnail');
      expect(e.title).toBe('Recruiting: Hard Lucid + Hard Will');
      expect(e.fields.length).toBeGreaterThan(0);
    }
  });
  it('builds a recruiting embed', () => {
    const p = buildNewPostMessage(makePost(), ORIGIN);
    const e = p.embeds![0] as any;
    expect(e.title).toBe('Recruiting: Hard Lucid + Hard Will');
    expect(e.url).toBe(`${ORIGIN}/posts/p1`);
    expect(e.thumbnail.url).toBe('https://img/a.png');
    expect(e.color).toBe(0x3b82f6);
    expect(p.allowed_mentions).toEqual({ parse: [] });
    const f = fields(p);
    expect(f.Slots).toBe('2/4');
    expect(f['Min CP']).toBe('50M');
    expect(f.Poster).toBe('Alice · Hero · Lv 280 · CP 1.5B');
    expect(f.Guild).toBe('Maple Guild');
    expect(f.Discord).toBe('alice');
    expect(f.World).toBe('Scania');
    expect(f.When).toBe('<t:1762804800:F> (<t:1762804800:R>)');
    expect(f.Note).toBe('bring pots');
  });

  it('labels a guildless post without blocking its announcement', () => {
    const message = buildNewPostMessage(makePost({ guild: null }), ORIGIN);
    expect(fields(message).Guild).toBe('No guild');
    expect(message.embeds).toHaveLength(1);
  });

  it('neutralizes mentions in the note and other user text', () => {
    const p = buildNewPostMessage(makePost({ note: '@everyone come <@123> @here' }), ORIGIN);
    const note = fields(p).Note as string;
    expect(note).not.toContain('@everyone');
    expect(note).not.toContain('@here');
    expect(note).not.toContain('<@123>');
    expect(p.allowed_mentions).toEqual({ parse: [] });
    const q = buildNewPostMessage(makePost({ guild: { id: 'g', name: '@everyone' } }), ORIGIN);
    expect(fields(q).Guild).not.toContain('@everyone');
  });

  it('truncates the note to 300 chars and omits an empty one', () => {
    expect((fields(buildNewPostMessage(makePost({ note: 'x'.repeat(500) }), ORIGIN)).Note as string).length).toBeLessThanOrEqual(300);
    expect(fields(buildNewPostMessage(makePost({ note: '  ' }), ORIGIN))).not.toHaveProperty('Note');
  });

  it('When: a finalized post shows a Discord timestamp, even with free times', () => {
    const f = fields(buildNewPostMessage(makePost({ freeTimes: [68], freeTimesZone: 'America/New_York' }), ORIGIN));
    expect(f.When).toMatch(/^<t:/);
    expect(f.When).toBe('<t:1762804800:F> (<t:1762804800:R>)');
  });
  it('When: not finalized with free times points to the post', () => {
    const f = fields(buildNewPostMessage(makePost({ scheduledAt: null, freeTimes: [68], freeTimesZone: 'America/New_York' }), ORIGIN));
    expect(f.When).toBe('Not set yet — see free times on the post');
  });
  it('When: not finalized with an empty grid is Flexible', () => {
    const f = fields(buildNewPostMessage(makePost({ scheduledAt: null, freeTimes: [], freeTimesZone: null }), ORIGIN));
    expect(f.When).toBe('Flexible');
  });
  it('LFP embed has no Slots/Min CP fields and is green', () => {
    const p = buildNewPostMessage(makePost({ type: 'lfp', partySize: null, minCp: null }), ORIGIN);
    const f = fields(p);
    expect(f).not.toHaveProperty('Slots');
    expect(f).not.toHaveProperty('Min CP');
    expect((p.embeds![0] as any).color).toBe(0x22c55e);
    expect((p.embeds![0] as any).title).toMatch(/^Looking for party: /);
  });

  it('omits Discord when the poster character is gone; no empty field values', () => {
    const post = makePost();
    post.poster.character = null;
    const f = fields(buildNewPostMessage(post, ORIGIN));
    expect(f).not.toHaveProperty('Discord');
    for (const v of Object.values(f)) expect((v as string).length).toBeGreaterThan(0);
  });
});

describe('pings', () => {
  const applicant = { ign: 'Bob', jobName: 'Bishop', level: 275, combatPower: 300_000_000 };
  it('join request', () => {
    const p = buildRequestPing({ recipientDiscordId: '555', kind: 'join_request', applicant, post: makePost(), webOrigin: ORIGIN });
    expect(p.content).toBe(`<@555> Bob (Bishop, 275, CP 300M) wants to join your Hard Lucid + Hard Will run → ${ORIGIN}/posts/p1`);
    expect(p.allowed_mentions).toEqual({ parse: [], users: ['555'] });
  });
  it('invite', () => {
    const p = buildRequestPing({ recipientDiscordId: '555', kind: 'invite', applicant, post: makePost(), webOrigin: ORIGIN });
    expect(p.content).toBe(`<@555> Alice invited Bob to their Hard Lucid + Hard Will run → ${ORIGIN}/posts/p1`);
    expect(p.allowed_mentions).toEqual({ parse: [], users: ['555'] });
  });
  it('neutralizes IGNs in pings', () => {
    const p = buildRequestPing({ recipientDiscordId: '555', kind: 'join_request', applicant: { ...applicant, ign: '@everyone' }, post: makePost(), webOrigin: ORIGIN });
    expect(p.content).not.toContain('@everyone');
  });
  it('accept', () => {
    const p = buildAcceptPing({ recipientDiscordId: '555', ign: 'Bob', post: makePost(), webOrigin: ORIGIN });
    expect(p.content).toBe(`<@555> Bob was accepted into Alice's Hard Lucid + Hard Will run → ${ORIGIN}/posts/p1`);
    expect(p.allowed_mentions).toEqual({ parse: [], users: ['555'] });
  });
  it('test message', () => {
    const p = buildTestMessage('@everyone Guild');
    expect(p.content).toBe(`✅ Party Finder is connected to @${ZW}everyone Guild.`);
    expect(p.allowed_mentions).toEqual({ parse: [] });
  });
});

describe('buildPostClosedMessage', () => {
  it('neutralizes mentions in boss names and permits no pings', () => {
    const post = makePost({ bosses: [{ bossDifficultyId: 1, bossName: '@everyone', difficulty: 'Hard' }] });
    const p = buildPostClosedMessage(post, ORIGIN, 'finalized');
    expect(p.content).toContain(`Post closed (finalized): Hard @${ZW}everyone`);
    expect(p.content).toContain(`${ORIGIN}/posts/p1`);
    expect(p.allowed_mentions).toEqual({ parse: [] });
  });
});

describe('buildWeeklyReminder', () => {
  it('lists each recipient once, separated by single spaces, and starts with them', () => {
    const post = weeklyReminderPost(makePost({ scheduledAt: '2025-11-10T20:00:00Z' }));
    const p = buildWeeklyReminder({ recipientDiscordIds: ['1', '2', '1'], post, webOrigin: ORIGIN });
    expect(p.content).toMatch(/^<@1> <@2> Weekly party reminder: \S/);
    expect(p.content).toContain(`<t:1762804800:F>`);
    expect(p.content).toContain(`${ORIGIN}/posts/p1`);
    expect(p.allowed_mentions).toEqual({ parse: [], users: ['1', '2'] });
    expect(buildWeeklyReminder({ recipientDiscordIds: [], post, webOrigin: ORIGIN }).content).toMatch(/^Weekly party reminder: /);
  });
});

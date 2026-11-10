# MapleStory Party Finder — Design

Date: 2026-11-09
Status: Draft for review

## 1. Intent

MapleStory guilds organize boss runs in Discord, and requests often go unanswered. Forming a party mostly depends on personally knowing who is around and roughly strong enough. Parties get built around who can clear a given boss, and stronger players will sometimes take a slightly weaker player along to balance the group out.

This app gives multiple guilds one shared place to:
- post that they're **looking for a boss party** or **recruiting for one**,
- size each other up through **Pokémon-card-style character cards**,
- request to join or invite people, and see the party take shape,
- get every post and request **pushed into their guild's Discord channel automatically**.

It starts with the owner's guild, but other guilds are first-class users. There is no shared Discord server between guilds, so the app broadcasts into each guild's own server.

### Success looks like
- A post made in the app shows up in every connected guild's Discord channel within seconds, with enough detail that people can decide without opening the app.
- A poster can look at applicants' cards and tell, at a glance, whether each one is strong enough and knows the mechanics for each boss in the run.
- Fewer requests go unanswered, and people from other guilds fill parties.

## 2. Goals, non-goals, anti-goals

**Goals**
- Discord login; one account can own several characters (main and alts).
- Character cards with data pulled automatically from Nexon's rankings plus player-entered info.
- Two post types (Looking for party / Recruiting), each covering one or more bosses.
- Join requests (on Recruiting posts) and invites (on Looking-for-party posts), with accept/decline.
- In-app notifications plus Discord channel pings.
- A party lineup view on each post for planning: compare CP and boss experience side by side.
- An admin area for the site owner to manage guilds, Discord channel links, boss list, and card rarity tiers.
- Multi-guild: every post is visible to, and broadcast to, every connected guild.

**Non-goals (for now)**
- Automatic party building or matchmaking. Humans choose; the app gives them the information.
- Guild-leader self-service. The site owner is the only admin.
- Per-user approval. Anyone who logs in can join any approved guild.
- Discord DMs and a Discord bot. Channel pings through webhooks are enough.
- Reading data from Maple Scouter. Players upload a screenshot.
- Chat inside the app. Discord remains where people talk.

**Anti-goals (would make this a failure even if it works)**
- Cards that go stale: level, class, and image must refresh from Nexon without anyone remembering to edit them.
- Posts lost in noise: closed or expired posts must leave the board.
- Discord spam that makes guilds mute the channel. Each event gets one concise message per guild, never duplicates.
- Heavy setup for a guild. Joining must only need the admin to paste a channel webhook URL.

## 3. Constraints and decided stack

- **Frontend:** React + TypeScript (user's choice).
- **Backend:** Node.js (user's choice). *Builder's call:* TypeScript on the backend too, plus the framework and ORM.
- **Database:** PostgreSQL. All app data lives here (user's choice).
- **Hosting:** Self-hosted with Docker Compose: frontend, backend, and Postgres, with uploaded screenshots on a mounted volume (*my call*; user was open to self-hosted or Vercel). Keep storage behind a small interface so it could move to S3-compatible storage or Vercel later.
- **Auth:** Discord OAuth2 (user agreed). The Discord user ID and username come from Discord. An optional account display name can be edited on Profile (from the header avatar/name); it is shown instead of the username on cards, party lineups and new Discord post messages. Character details also show the real @username for copying. Clearing the display name restores the username; login preserves the chosen name and Discord mentions still use the Discord user ID.
- **Discord delivery:** Discord channel webhooks, one per guild, configured by the admin. Pings use the `<@discordUserId>` mention syntax inside the webhook message. This requires the mentioned user to be in that server, which is expected because they belong to that guild.

## 4. Users and roles

- **Visitor (not logged in):** *my call*: can browse posts and cards read-only, since this helps recruiting. Logging in is required to post, request, or invite.
- **Player:** logs in with Discord, adds characters, picks a guild for each from the approved list (no approval step), creates posts, requests and invites, and accepts or declines.
- **Admin:** the site owner. Marked by Discord user ID in config/env (*my call*). Manages everything in §9.

## 5. Characters and cards

### 5.1 Adding a character
1. Player enters the IGN. The lookup searches all worlds (`reboot_index=0`). If the same name exists on several worlds, the player picks one.
2. Backend looks up the character on Nexon's rankings feed (§8) and shows a preview (image, level, class, world). Player confirms.
3. Player fills in:
   - **Combat power** (number, required)
   - **Guild** (from the admin's approved list, required)
   - **Maple Scouter screenshot** (image upload, optional but encouraged; *my call*: PNG/JPG/WebP, 5 MB max)
   - **Bosses they can do:** any number of (boss, difficulty, experience level) entries. Experience level is one of **Learning / Cleared before / Can teach-carry**.
   - **Usual play times:** *my call*: a weekly grid of days × hours (hourly slots, user's decision), stored in UTC and shown in each viewer's own time zone.
   - **Note:** short free text (e.g., "can carry Hard Lucid, LF Normal Kalos").
4. The Discord username is shown automatically from the owner's account.

A character's name and world uniquely identify it. Only one account can claim a given character. *My call:* first claim wins; the admin can reassign it.

### 5.2 Card (summary view)
Shown in grids, on posts, and on applicant lists. Pokémon-card style:
- **Top bar:** IGN and level.
- **Art window:** character image from Nexon.
- **Stats box:** class, combat power (prominent), guild, world.
- **Footer:** small detail such as Discord username or last-synced date (builder's call).
- **Type color by class archetype:** Warrior red, Magician blue, Bowman green, Thief purple, Pirate gold. Xenon gets a split Thief/Pirate frame (*my guess*). Mapping class name to archetype is a static table in code.
- **Rarity by CP:** tiered frame treatment from plain up to holographic foil with a hover shimmer. The admin sets the tier cutoffs (§9). *My call:* 4–5 tiers.
- **Context badges:** When a card appears in a post's applicant or lineup view, it shows the character's experience level for **each boss in that post** (e.g., "Hard Will: Can carry · Hard Lucid: Learning · Normal Gloom: not listed").

### 5.3 Card detail (popup)
Clicking a card opens a modal with everything: the full card, Scouter screenshot (click to enlarge), Discord username, all bosses with difficulty and experience, play times, and note. *My call:* the owner sees an "Edit" button here.

### 5.4 Staying fresh
Level, class, and image re-sync from Nexon automatically. *My call:* a daily background job, plus on-demand refresh when the owner opens their character, rate-limited. CP and screenshots are player-maintained. Show "CP updated N days ago" so viewers can judge staleness.

## 6. Posts

### 6.1 Fields
- **Type:** Looking for party (LFP) or Recruiting.
- **Character:** which of the poster's characters.
- **Bosses:** one or more (boss, difficulty) pairs from the admin-managed boss list.
- **When:** a specific date and time (stored in UTC, shown in the viewer's time zone) or "Flexible."
- **Party size / open slots:** Recruiting only. Total party size up to 6 (*my call*: boss caps vary; 6 is the common max, and the admin's boss list may store a per-boss cap the form respects).
- **Minimum CP:** optional, Recruiting only. Informational: applicants below it see a warning but can still apply (*my call*, because carrying weaker players is a normal practice).
- **Note:** free text.

### 6.2 Board
- A list or grid of open posts, newest first, with filters for type, boss, difficulty, guild, and date (*my call* on the exact filter set).
- Each post shows the poster's card, bosses, time, slots filled/total, and guild.

### 6.3 Recruiting post flow
1. Another player clicks **Request to join** and picks one of their characters.
2. The poster gets an in-app notification and a Discord ping (§7).
3. The poster opens the post and sees applicants as cards with per-boss experience badges, then **Accepts** or **Declines**.
4. Accepted characters appear in the post's **party lineup**: cards side by side with CP and per-boss experience. This is the planning view.
5. The applicant is notified of the decision in-app (*my call*: also pinged in the applicant's guild channel on accept only, to limit noise).
6. The poster can remove a lineup member, and members can leave (*my call*).

### 6.4 Looking-for-party post flow
1. A recruiter clicks **Invite** and picks one of their own open Recruiting posts.
2. The LFP poster gets an in-app notification and a Discord ping.
3. They Accept (joining that Recruiting post's lineup) or Decline.

### 6.5 Lifecycle
- Posts close automatically when the scheduled time has passed (*my call*: a few hours of grace) or when a Recruiting post's slots are full.
- "Flexible" posts expire after a set period (*my call*: 7 days) unless renewed.
  - *Ruling (deep review):* editing a post never extends its expiry; only a new time recomputes it, and an expired post can be edited only to give it a new time. Use **Renew** to extend a Flexible post. This supersedes the plan 2 rule that every edit recomputes `expiresAt`.
- The poster can close or **delete** their own post at any time (user's decision).
- **Only the poster can edit their post, and they can change any field** (user's decision): type, character, bosses, time, party size, minimum CP, and note. *My calls*, to keep existing parties valid:
  - Type and character are locked once others have joined.
  - Party size can't drop below the current member count. Setting it equal to the member count fills the post; raising it on a full post reopens it.
  - A change that invalidates pending requests (type, world, or the post becoming full) auto-declines them.
- **Team comps never disappear** (user's decision). Any post that had at least one accepted member keeps its party record (bosses, time, and lineup) for everyone in it: the poster and every accepted member. This holds whether the post filled, expired, was closed, or was **deleted** by the poster. Deleting only removes the post from the board and stops new requests. *Builder's call:* implement as a soft delete or a separate party snapshot.
- **"My parties"** page: each player sees their current and past parties across all their characters. Each one opens a read-only party view with the lineup cards. *My call:* the lineup cards show each character's current data, plus the CP they had when the party formed.
- A post deleted with no accepted members is simply gone for players.
- *My call:* other players can't see closed or deleted posts. The admin can see everything and hard-delete for moderation (§9).

## 7. Notifications and Discord

### 7.1 In-app
A bell icon with an unread count. It lists join requests, invites, accepts, and declines, each linking to the relevant post.

### 7.2 Discord messages (webhooks)
- **New post:** one message to **every** connected guild's channel. Uses an embed with type, bosses and difficulties, time (Discord timestamp format so it localizes), slots, min CP, poster IGN/class/level/CP/guild, Discord username, note, character image thumbnail, and a link to the post.
- **Join request / invite:** one message to the **recipient's own guild channel**, @mentioning them, e.g. "<@id> Lily (Angelic Buster, 279, CP 12.3M) wants to join your Hard Lucid + Hard Will run →link".
- **Accepted:** *my call*: one ping to the accepted player's guild channel.
- *My call:* no Discord message for declines, edits, or closes, to avoid spam. If a post is deleted soon after creation, the builder may edit or delete the original webhook messages (webhooks support this) but doesn't have to.
- Delivery must not block the user's action. Send in the background with retries. A failing webhook is logged and shown to the admin, not to players.

## 8. Nexon data source

Verified 2026-11-09: a public JSON endpoint backs the official rankings page.

```
GET https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na
    ?type=overall&id=weekly&reboot_index=0&page_index=1&character_name=<IGN>
```

A sample response (trimmed) for `character_name=Lily`:

```json
{"totalCount":1,"pageIndex":1,"ranks":[{"characterName":"Lily","exp":1386266788148,
 "level":279,"rank":228077,"worldID":1,"characterImgURL":"https://msavatar1.nexon.net/Character/....png",
 "jobName":"Angelic Buster","legionLevel":0,"raidPower":0,"tierID":0,"starSum":0}]}
```

- Fields used: `characterName`, `level`, `jobName`, `worldID`, `characterImgURL`.
- **Not provided:** combat power and guild, which come from the player.
- `reboot_index` selects Heroic (reboot) vs Interactive worlds. The builder must confirm which value means which and map `worldID` to world names (static table).
- This is unofficial and may change or rate-limit. Call it only from the backend, cache results, throttle the daily sync, and handle "not found" or changed-format responses gracefully (keep the last known data and flag it as stale).
- *My call:* proxy or cache the character image through the backend if hotlinking proves unreliable. Otherwise store the URL.

## 9. Admin area

Only accessible to the admin. Lets them:
- **Guilds:** create, edit, and remove guilds (name, world, optional icon), and set each guild's **Discord webhook URL** with a "send test message" button. Removing a guild stops broadcasts to it. *My call:* it soft-disables, keeping that guild's characters but hiding them from guild pickers.
- **Boss list:** manage bosses and their difficulties (name, difficulty, optional party cap, optional image). Seed with current endgame bosses.
- **Rarity tiers:** edit CP cutoffs and names.
- **Moderation:** view and delete posts, reassign or delete characters, ban users (*my call*: a minimum safeguard since anyone can join).
- **Webhook health:** see recent failed Discord deliveries per guild.

## 10. Data (outline, builder refines)

- `users`: Discord ID, username, avatar, created, banned flag
- `guilds`: name, world, webhook URL (treat as a secret), active flag
- `characters`: owner user, IGN, world, class, level, image URL, CP, CP updated at, guild, screenshot path, note, play times, last Nexon sync, sync status
- `character_bosses`: character, boss difficulty, experience level
- `bosses` / `boss_difficulties`: name, difficulty, party cap
- `posts`: type, poster character, scheduled time or flexible, size, min CP, note, status, created/closed
- `post_bosses`: post, boss difficulty
- `post_members`: post, character, role (poster/member)
- `requests`: post, character, kind (join_request/invite), status, created, decided
- `notifications`: user, kind, payload/link, read at
- `rarity_tiers`: name, min CP, order
- `webhook_deliveries`: guild, event, status, attempts, last error

## 11. Left to the builder

- Backend framework, ORM, migrations, validation, and API style.
- Frontend routing, state management, styling approach, and the exact card art (frames, foil effect), within §5.2.
- Background job mechanism (in-process scheduler is fine at this scale).
- Exact filter set, pagination, and responsive layout (should work on phones; people check from Discord on mobile).
- Session handling, security basics (CSRF, upload validation, rate limiting), and keeping webhook URLs secret.
- Seed data for the boss list.
- Testing approach.

## 12. Party and request rules (*my calls*, settled after review)

- When an LFP poster accepts an invite, their LFP post closes automatically.
- A character can be in several lineups and have several open posts. The app doesn't block overlapping times. *Builder's call:* show a soft warning on overlap.
- When a Recruiting post fills, its pending requests are auto-declined and the applicants get an in-app notification. No Discord ping.
- If a member leaves or is removed from a full post, it reopens.
- One pending request or invite per (post, character).

## 13. Region scope (*my call*)

North America only for v1 (the user's link and the verified endpoint are NA). Keep a `region` value in the Nexon client and the world table so EU could be added later without reshaping data.

## 14. Worlds

You can only party with characters on the same world. The user's guild plays Kronos, but members also play temporary event worlds (e.g., Challenger World) that appear for a season.

- A **guild is a Discord community, not tied to one world.** The admin sets which worlds each guild plays (multi-select, editable as event worlds come and go). This replaces the single `world` field on guilds in §9/§10. A character may pick any approved guild, whatever its world.
- Every **post has a world**, taken from the poster's character.
- **Broadcasts** for a new post go only to guilds whose world list includes that post's world. This refines "every connected guild" in §2/§7.2: every guild that plays that world. Request, invite, and accept pings are unchanged (recipient's guild channel).
- **Join requests and invites** only allow characters on the post's world. The character picker hides the others.
- **Board** defaults to the worlds the viewer has characters on, with a filter to change it. The world is shown prominently on posts, cards, and Discord messages.
- **Event worlds:** *builder's call* how to detect them. The admin can add a world to the world table if Nexon's `worldID` for a new event world isn't known yet. Characters on a world that has ended remain as-is. *My call:* the admin can mark a world inactive to hide it from pickers and filters.

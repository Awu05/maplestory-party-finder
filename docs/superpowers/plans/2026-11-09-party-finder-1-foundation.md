# Party Finder — Plan 1: Foundation, Characters & Cards

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running app where players log in with Discord, add their MapleStory characters (synced from Nexon), and browse each other's Pokémon-style character cards. The admin manages guilds, worlds, bosses, and rarity tiers.

**Architecture:** An npm-workspaces monorepo with three packages:
- `server/`: Fastify + Prisma + Postgres
- `web/`: Vite + React + TanStack Query
- `shared/`: TypeScript domain logic and API types used by both

External services (Discord OAuth, Nexon rankings, file storage) sit behind small interfaces injected into `buildApp()`, so tests use fakes. Postgres runs in Docker for dev and tests.

**Tech Stack:** Node 24, TypeScript 5, Fastify 5, Prisma 6, PostgreSQL 16, Zod, Vitest, Supertest-style `app.inject`, React 18, React Router 6, TanStack Query 5, Testing Library, tsup, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-09-party-finder-design.md`

**Plan series:** This is plan 1 of 3. Plan 2 covers posts, join requests and invites, lineups, the board, and "My parties". Plan 3 covers in-app notifications, Discord webhooks, the daily Nexon sync job, and moderation and webhook health. Each plan ships working software.

## Global Constraints

- Frontend is React + TypeScript; backend is Node.js (TypeScript); all app data is in PostgreSQL.
- Login is Discord OAuth2 only, with scope `identify`. The Discord username on cards comes from Discord and can't be edited.
- The admin is whoever has a Discord ID listed in env `ADMIN_DISCORD_IDS` (comma-separated).
- No per-user approval: any logged-in, non-banned user can add characters to any **active** guild.
- Nexon is called only from the backend. Endpoint: `https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na?type=overall&id=weekly&reboot_index=0&page_index=1&character_name=<IGN>`. `reboot_index=0` = all worlds (verified 2026-11-09; 1 = Heroic only, 2 = Interactive only).
- Combat power and guild come from the player. Level, class (`jobName`), world (`worldID`), and image (`characterImgURL`) come from Nexon.
- Screenshot uploads: PNG, JPG, or WebP only, 5 MB max, checked by file signature, not extension.
- A character is unique by (IGN case-insensitive, world). The first claim wins.
- Experience levels: `learning` ("Learning"), `cleared` ("Cleared before"), `can_carry` ("Can teach/carry").
- Archetype colors: Warrior red, Magician blue, Bowman green, Thief purple, Pirate gold, Xenon split Thief/Pirate.
- Times are stored in UTC and shown in the viewer's time zone.
- Guilds are not tied to one world: each guild has a set of worlds it plays. A character can pick any active guild.
- Non-admin API responses never include a guild's `webhookUrl`.
- Visitors (not logged in) can read characters, guilds, worlds, bosses, and tiers. Writing anything requires login.
- Must work at phone width.
- North America only.

## Review Focus

1. **IGN casing:** "lily" and "Lily" are the same character. Lookup finds it, and a second claim gets a 409 response. (Tests in Task 4 and Task 8.)
2. **Nexon fails or changes format:** create returns 502 `NEXON_UNAVAILABLE` and saves nothing. Refresh keeps the last data and sets `syncStatus: "stale"`. (Tests in Task 8 and Task 9.)
3. **Bad uploads:** a text file renamed `.png`, or a 6 MB image, gets 400 and nothing is written to disk. (Test in Task 7.)
4. **Webhook URL leaks:** `GET /api/guilds` as a visitor or non-admin never includes `webhookUrl`. (Test in Task 6.)
5. **Large CP values:** CP of 1,500,000,000 (above int32) saves and returns exactly. (Test in Task 8.)

---

## File Structure

```
package.json                 # workspaces: shared, server, web; root scripts
docker-compose.yml           # dev: postgres (+ test DB via init script)
docker-compose.prod.yml      # prod: db, server (serves web build), uploads volume
docker/initdb/01-test-db.sql # creates partyfinder_test
.env.example
shared/
  src/index.ts               # re-exports
  src/archetype.ts           # classToArchetype
  src/rarity.ts              # rarityFor
  src/playTimes.ts           # local hour <-> UTC hour-of-week
  src/types.ts               # API DTOs + enums
  test/*.test.ts
server/
  prisma/schema.prisma
  prisma/seed.ts
  src/index.ts               # boots real deps
  src/app.ts                 # buildApp(deps)
  src/config.ts
  src/http/errors.ts         # AppError + error handler
  src/auth/discordOAuth.ts   # DiscordOAuth interface + real impl
  src/auth/routes.ts
  src/auth/guards.ts         # requireUser, requireAdmin, getViewer
  src/nexon/client.ts        # NexonClient interface + HttpNexonClient
  src/storage/storage.ts     # Storage interface + LocalDiskStorage
  src/storage/imageType.ts   # sniffImageType
  src/catalog/routes.ts      # public + admin: worlds, guilds, bosses, tiers
  src/characters/routes.ts
  src/characters/service.ts
  src/characters/serialize.ts
  test/helpers.ts            # buildTestApp, resetDb, loginAs, factories, FakeNexon, FakeDiscord
  test/globalSetup.ts        # migrate test DB
  test/fixtures/nexon-lily.json
  test/*.test.ts
web/
  index.html, vite.config.ts
  src/main.tsx, src/App.tsx
  src/api/client.ts          # api<T>()
  src/api/hooks.ts           # useMe, useCharacters, useCatalog...
  src/components/Layout.tsx
  src/components/card/CharacterCard.tsx + card.css
  src/components/card/CardDetailModal.tsx
  src/components/PlayTimeGrid.tsx
  src/pages/CharactersPage.tsx
  src/pages/MyCharactersPage.tsx
  src/pages/CharacterFormPage.tsx
  src/pages/admin/*.tsx
  test/*.test.tsx
```

---

### Task 1: Workspace scaffold, dev database, health endpoint

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `docker-compose.yml`, `docker/initdb/01-test-db.sql`
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/app.ts`, `server/src/index.ts`, `server/src/config.ts`, `server/src/http/errors.ts`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`
- Test: `server/test/health.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env: NodeJS.ProcessEnv): Config`. `Config = { port: number; databaseUrl: string; sessionSecret: string; discordClientId: string; discordClientSecret: string; discordRedirectUri: string; webOrigin: string; adminDiscordIds: string[]; uploadDir: string }`.
  - `buildApp(deps: AppDeps): Promise<FastifyInstance>`. `AppDeps` starts as `{ config: Config }`, and later tasks add fields.
  - `class AppError extends Error { constructor(status: number, code: string, message?: string) }`. The registered error handler replies `{ error: { code, message } }`. Zod errors map to 400 `VALIDATION`.
  - The package name `@pf/shared` is importable from server and web.

- [ ] **Step 1:** Run `git init` and add `.gitignore` (node_modules, dist, .env, .env.test, uploads). Create the root `package.json` with `"workspaces": ["shared","server","web"]` and scripts `test` (`npm test -ws --if-present`), `dev:db` (`docker compose up -d db`).
- [ ] **Step 2:** Create `docker-compose.yml` with service `db`: `postgres:16`, user/pass `pf/pf`, db `partyfinder`, port `5432:5432`, named volume. Mount `./docker/initdb` to `/docker-entrypoint-initdb.d`. The `01-test-db.sql` file contains `CREATE DATABASE partyfinder_test;`.
- [ ] **Step 3:** Write the failing test `server/test/health.test.ts`:

```ts
it('GET /api/health returns ok', async () => {
  const app = await buildApp({ config: testConfig() });
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});
```

`testConfig()` lives in `server/test/helpers.ts` and returns a `Config` with fixed fake values: a 32+ char session secret, `adminDiscordIds: ['admin-1']`, and `uploadDir` set to a temp dir.

- [ ] **Step 4:** Run `npm test -w server`. Expected: FAIL, `buildApp` not found.
- [ ] **Step 5:** Implement `config.ts`, `errors.ts`, and `app.ts`. All routes are under the `/api` prefix. `index.ts` loads `.env` (dotenv), builds the app, and listens on `config.port`.
- [ ] **Step 6:** Run `npm test -w server`. Expected: PASS.
- [ ] **Step 7:** Run `docker compose up -d db`, then `docker compose exec db psql -U pf -l`. Expected: the output lists `partyfinder` and `partyfinder_test`.
- [ ] **Step 8:** Commit: `chore: scaffold workspaces, dev db, health endpoint`.

---

### Task 2: Database schema and test harness

**Files:**
- Create: `server/prisma/schema.prisma`, `server/.env.test`, `server/test/globalSetup.ts`
- Modify: `server/test/helpers.ts`, `server/vitest.config.ts` (`globalSetup`, `fileParallelism: false`)
- Test: `server/test/db.test.ts`

**Interfaces:**
- Produces: these Prisma models. Plans 2 and 3 add more.

```prisma
enum WorldType { heroic interactive }
enum Experience { learning cleared can_carry }
enum SyncStatus { ok stale }

model User      { id String @id @default(cuid()); discordId String @unique; username String; avatar String?; banned Boolean @default(false); createdAt DateTime @default(now()); characters Character[] }
model World     { id Int @id @default(autoincrement()); nexonWorldId Int @unique; name String; worldType WorldType; active Boolean @default(true); guilds GuildWorld[]; characters Character[] }
model Guild     { id String @id @default(cuid()); name String @unique; iconUrl String?; webhookUrl String?; active Boolean @default(true); worlds GuildWorld[]; characters Character[] }
model GuildWorld { guildId String; worldId Int; guild Guild @relation(fields:[guildId], references:[id], onDelete: Cascade); world World @relation(fields:[worldId], references:[id]); @@id([guildId, worldId]) }
model Boss      { id Int @id @default(autoincrement()); name String @unique; imageUrl String?; sortOrder Int @default(0); difficulties BossDifficulty[] }
model BossDifficulty { id Int @id @default(autoincrement()); bossId Int; boss Boss @relation(fields:[bossId], references:[id], onDelete: Cascade); difficulty String; partyCap Int @default(6); sortOrder Int @default(0); characters CharacterBoss[]; @@unique([bossId, difficulty]) }
model Character {
  id String @id @default(cuid())
  ownerId String; owner User @relation(fields:[ownerId], references:[id])
  ign String; ignLower String
  worldId Int; world World @relation(fields:[worldId], references:[id])
  jobName String; level Int; imageUrl String
  combatPower BigInt; cpUpdatedAt DateTime
  guildId String; guild Guild @relation(fields:[guildId], references:[id])
  screenshotKey String?; note String @default(""); playTimes Int[] @default([])
  lastSyncedAt DateTime; syncStatus SyncStatus @default(ok); lastRefreshRequestedAt DateTime?
  createdAt DateTime @default(now())
  bosses CharacterBoss[]
  @@unique([ignLower, worldId])
}
model CharacterBoss { characterId String; character Character @relation(fields:[characterId], references:[id], onDelete: Cascade); bossDifficultyId Int; bossDifficulty BossDifficulty @relation(fields:[bossDifficultyId], references:[id]); experience Experience; @@id([characterId, bossDifficultyId]) }
model RarityTier { id Int @id @default(autoincrement()); name String @unique; minCp BigInt; sortOrder Int }
```

- Produces (test helpers in `server/test/helpers.ts`):
  - `prisma: PrismaClient` points at `partyfinder_test`.
  - `resetDb(): Promise<void>` truncates every table with `RESTART IDENTITY CASCADE`.
  - Factories:
    - `makeUser(over?) → User`
    - `makeWorld(over?) → World` (default `{nexonWorldId: 45, name: 'Kronos', worldType: 'heroic'}`)
    - `makeGuild(over?: {worldIds?: number[]} & Partial<Guild>) → Guild`
    - `makeBossDifficulty(over?) → BossDifficulty & {boss: Boss}`
    - `makeCharacter(over?) → Character`

- [ ] **Step 1:** Write the failing test `db.test.ts`. It runs `makeCharacter()` twice with the same `ignLower` and world, and expects the second to reject with Prisma code `P2002`.
- [ ] **Step 2:** Run `npm test -w server`. Expected: FAIL, no schema or tables.
- [ ] **Step 3:** Add the schema. Run `npx prisma migrate dev --name init` with `DATABASE_URL` set to the dev DB. In `globalSetup.ts`, run `prisma migrate deploy` against `.env.test`'s `DATABASE_URL`. Implement the helpers. Each test file calls `resetDb()` in `beforeEach`.
- [ ] **Step 4:** Run `npm test -w server`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(db): initial schema and test harness`.

---

### Task 3: Shared domain logic (archetype, rarity, play times, DTOs)

**Files:**
- Create: `shared/src/archetype.ts`, `shared/src/rarity.ts`, `shared/src/playTimes.ts`, `shared/src/types.ts`, `shared/vitest.config.ts`
- Test: `shared/test/archetype.test.ts`, `shared/test/rarity.test.ts`, `shared/test/playTimes.test.ts`

**Interfaces:**
- Produces:
  - `type Archetype = 'warrior'|'magician'|'bowman'|'thief'|'pirate'|'xenon'|'unknown'`
  - `classToArchetype(jobName: string): Archetype`. It matches case-insensitively and trims. The table contains:
    - **Warrior:** Hero, Paladin, Dark Knight, Dawn Warrior, Mihile, Aran, Demon Slayer, Demon Avenger, Blaster, Kaiser, Hayato, Zero, Adele
    - **Magician:** Arch Mage (Fire, Poison), Arch Mage (Ice, Lightning), Bishop, Blaze Wizard, Evan, Luminous, Battle Mage, Kanna, Kinesis, Illium, Lara, Beast Tamer, Lynn
    - **Bowman:** Bowmaster, Marksman, Pathfinder, Wind Archer, Mercedes, Wild Hunter, Kain
    - **Thief:** Night Lord, Shadower, Blade Master, Dual Blade, Night Walker, Phantom, Cadena, Hoyoung, Khali
    - **Pirate:** Buccaneer, Corsair, Cannoneer, Cannon Master, Thunder Breaker, Mechanic, Angelic Buster, Shade, Jett, Ark, Mo Xuan
    - **Xenon:** Xenon
    - **Anything else:** `unknown` (neutral frame)
  - `type TierLike = { name: string; minCp: number; sortOrder: number }`
  - `rarityFor(cp: number, tiers: TierLike[]): { tier: TierLike; rank: number; isTop: boolean } | null`. It picks the highest-`minCp` tier with `minCp <= cp`. `rank` is the tier's 0-based index in ascending `minCp` order. It returns null when no tier qualifies.
  - Hour-of-week index: `utcHour = day*24 + hour`, where day 0 = Sunday, in the range 0..167.
  - Play times use **hourly** slots (user's decision). A `LocalHour = { day: number /* 0=Sun */; hour: number /* 0..23 local */ }`.
  - `localHoursToUtcHours(slots: LocalHour[], tzOffsetMinutes: number): number[]` returns the sorted, unique UTC hour-of-week values. `tzOffsetMinutes` follows JS `Date#getTimezoneOffset()` sign (UTC−5 → 300). Wrap modulo 168. Half-hour offsets floor to the hour.
  - `utcHoursToLocalHours(hours: number[], tzOffsetMinutes: number): LocalHour[]` is the inverse, sorted by day then hour.
  - `types.ts`:
    - `ExperienceLevel = 'learning'|'cleared'|'can_carry'`
    - `EXPERIENCE_LABELS: Record<ExperienceLevel,string>`, with labels from Global Constraints
    - `CharacterDTO`:

```ts
interface CharacterDTO {
  id: string; ign: string; world: { id: number; name: string };
  jobName: string; level: number; imageUrl: string;
  combatPower: number; cpUpdatedAt: string;
  guild: { id: string; name: string; iconUrl: string | null };
  screenshotUrl: string | null; note: string; playTimes: number[];
  bosses: { bossDifficultyId: number; bossName: string; difficulty: string; experience: ExperienceLevel }[];
  owner: { discordUsername: string }; isOwner: boolean;
  syncStatus: 'ok' | 'stale'; lastSyncedAt: string;
}
```

    - `NexonCharacterPreview = { ign: string; level: number; jobName: string; imageUrl: string; nexonWorldId: number; worldName: string | null }`
    - `GuildDTO = { id; name; iconUrl: string|null; worldIds: number[]; active: boolean }`
    - `AdminGuildDTO = GuildDTO & { webhookUrl: string|null }`
    - `WorldDTO = { id; nexonWorldId; name; worldType: 'heroic'|'interactive'; active }`
    - `BossDTO = { id; name; imageUrl: string|null; difficulties: { id; difficulty; partyCap }[] }`
    - `RarityTierDTO = { id; name; minCp: number; sortOrder }`
    - `MeDTO = { id; discordUsername; avatarUrl: string|null; isAdmin: boolean } | null`

- [ ] **Step 1:** Write the failing tests:

```ts
expect(classToArchetype('Angelic Buster')).toBe('pirate');
expect(classToArchetype('  arch mage (ice, lightning) ')).toBe('magician');
expect(classToArchetype('Xenon')).toBe('xenon');
expect(classToArchetype('Brand New Class')).toBe('unknown');

const tiers = [{name:'Common',minCp:0,sortOrder:0},{name:'Rare',minCp:20_000_000,sortOrder:1},{name:'Legendary',minCp:400_000_000,sortOrder:4}];
expect(rarityFor(19_999_999, tiers)).toMatchObject({ tier:{name:'Common'}, rank:0, isTop:false });
expect(rarityFor(20_000_000, tiers)).toMatchObject({ tier:{name:'Rare'}, rank:1 });
expect(rarityFor(1_500_000_000, tiers)).toMatchObject({ tier:{name:'Legendary'}, isTop:true });
expect(rarityFor(5, [])).toBeNull();

// UTC-5 (offset 300): Sunday local 20:00 => Monday 01:00 UTC
expect(localHoursToUtcHours([{day:0,hour:20},{day:0,hour:21}], 300)).toEqual([25,26]);
// Saturday local 23:00 at UTC-5 wraps to Sunday 04:00 UTC
expect(localHoursToUtcHours([{day:6,hour:23}], 300)).toEqual([4]);
expect(utcHoursToLocalHours([25], 300)).toEqual([{day:0,hour:20}]);
// round trip
const b = [{day:3,hour:9},{day:5,hour:0}];
expect(utcHoursToLocalHours(localHoursToUtcHours(b, -540), -540)).toEqual(b);
```

- [ ] **Step 2:** Run `npm test -w shared`. Expected: FAIL.
- [ ] **Step 3:** Implement the functions and types above, and re-export everything from `shared/src/index.ts`.
- [ ] **Step 4:** Run `npm test -w shared`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(shared): archetypes, rarity tiers, hourly play-time conversion, DTOs`.

---

### Task 4: Nexon client

**Files:**
- Create: `server/src/nexon/client.ts`, `server/test/fixtures/nexon-lily.json` (save the real response: `curl -A "Mozilla/5.0" "<endpoint>&character_name=Lily"`)
- Test: `server/test/nexon.test.ts`

**Interfaces:**
- Produces:
  - `NexonCharacter = { ign: string; level: number; jobName: string; imageUrl: string; nexonWorldId: number }`
  - `interface NexonClient { findByName(ign: string): Promise<NexonCharacter[]> }`. It returns only exact case-insensitive name matches, possibly several (same name on different worlds). It returns `[]` when not found.
  - `class NexonUnavailableError extends Error`. It's thrown on network errors, non-2xx responses, or a missing or wrong-shaped `ranks` array (validated with Zod).
  - `class HttpNexonClient implements NexonClient { constructor(opts: { fetch?: typeof fetch; cacheTtlMs?: number /* default 600_000 */; now?: () => number }) }`. It sends `User-Agent: party-finder/1.0`, URL-encodes the IGN, and caches results by `ign.toLowerCase()`.
  - `AppDeps` gains `nexon: NexonClient`.
  - `test/helpers.ts` gains `class FakeNexon implements NexonClient { set(chars: NexonCharacter[]); failNext(); }`.

- [ ] **Step 1:** Write the failing tests, each with an injected `fetch` stub:
  - `parses fixture`: `findByName('lily')` returns `[{ ign:'Lily', level:279, jobName:'Angelic Buster', nexonWorldId:1, imageUrl: expect.stringMatching(/^https:\/\/msavatar1\.nexon\.net\//) }]`. Also asserts the request URL contains `reboot_index=0` and `character_name=lily`.
  - `filters non-exact matches`: given a stub response with `Lily` and `Lilyy`, `findByName('LILY')` returns only `Lily`.
  - `empty ranks → []`.
  - `500 → throws NexonUnavailableError`. `{"unexpected":true} → throws NexonUnavailableError`.
  - `caches`: two calls within the TTL make one fetch. After `now` advances 600_001 ms, it fetches again.
- [ ] **Step 2:** Run `npm test -w server -- nexon`. Expected: FAIL.
- [ ] **Step 3:** Implement `HttpNexonClient` and `FakeNexon`.
- [ ] **Step 4:** Run `npm test -w server -- nexon`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): Nexon rankings client`.

---

### Task 5: Discord login, sessions, guards

**Files:**
- Create: `server/src/auth/discordOAuth.ts`, `server/src/auth/routes.ts`, `server/src/auth/guards.ts`
- Modify: `server/src/app.ts` (register `@fastify/secure-session` with cookie `pf_session`, httpOnly, sameSite lax, secure when `webOrigin` is https), `server/test/helpers.ts`
- Test: `server/test/auth.test.ts`

**Interfaces:**
- Produces:
  - `interface DiscordOAuth { authorizeUrl(state: string): string; exchangeCode(code: string): Promise<{ discordId: string; username: string; avatarUrl: string | null }> }`
  - `HttpDiscordOAuth(config)` is the real implementation:
    - It POSTs to `https://discord.com/api/oauth2/token` (`grant_type=authorization_code`).
    - Then it calls `GET https://discord.com/api/users/@me`.
    - `username` = the Discord `username` field.
    - `avatarUrl` = `https://cdn.discordapp.com/avatars/{id}/{avatar}.png`, or null.
  - `AppDeps` gains `prisma: PrismaClient` and `discord: DiscordOAuth`.
  - Routes:
    - `GET /api/auth/discord` generates a random state, stores it in the session, and responds 302 to `authorizeUrl(state)`.
    - `GET /api/auth/discord/callback?code&state` returns 400 `BAD_STATE` if the state doesn't match. Otherwise it upserts the user by `discordId` (updating username and avatar), sets `session.userId`, and responds 302 to `config.webOrigin`.
    - `GET /api/auth/me` returns `MeDTO`.
    - `POST /api/auth/logout` clears the session and returns 204.
  - Guards (Fastify preHandlers / helpers):
    - `getViewer(req): Promise<{ user: User; isAdmin: boolean } | null>`. A banned user counts as null for reads.
    - `requireUser(req)` returns 401 `UNAUTHENTICATED` with no session, or 403 `BANNED` if banned.
    - `requireAdmin(req)` returns 403 `FORBIDDEN` if the user isn't an admin.
  - Test helpers:
    - `FakeDiscord` accepts code `fake:<discordId>:<username>`.
    - `buildTestApp(over?: Partial<AppDeps>) → { app, nexon: FakeNexon }` wires up the test prisma, FakeDiscord, FakeNexon, and a temp-dir storage (Task 7).
    - `loginAs(app, discordId = 'u-1', username = 'tester') → Promise<string>`. It performs the redirect and callback and returns the `cookie` header value.

- [ ] **Step 1:** Write the failing tests:
  - `login flow`: `loginAs(app,'u-1','andy')`, then `GET /api/auth/me` with the cookie returns `{ discordUsername:'andy', isAdmin:false }`, and the DB has one user.
  - `second login updates username`: log in again as `'u-1','andy2'`. Still one user, now with username `andy2`.
  - `bad state → 400 BAD_STATE`.
  - `admin by env`: `loginAs(app,'admin-1')`, then `me.isAdmin === true`.
  - `logged out me → null`.
  - `banned user`: set `banned=true` after login, then a guarded test route (registered in the test only) returns 403 `BANNED`.
- [ ] **Step 2:** Run `npm test -w server -- auth`. Expected: FAIL.
- [ ] **Step 3:** Implement the auth module and helpers.
- [ ] **Step 4:** Run `npm test -w server -- auth`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): Discord OAuth login and guards`.

---

### Task 6: Catalog API (worlds, guilds, bosses, rarity tiers) with admin management

**Files:**
- Create: `server/src/catalog/routes.ts`
- Test: `server/test/catalog.test.ts`

**Interfaces:**
- Produces (all JSON; admin routes use `requireAdmin`; bodies validated with Zod):
  - Public:
    - `GET /api/worlds` → `WorldDTO[]` (active only; `?all=1` includes inactive, admin only)
    - `GET /api/guilds` → `GuildDTO[]` (active only, **no webhookUrl**)
    - `GET /api/bosses` → `BossDTO[]` (sorted by `sortOrder`, difficulties sorted)
    - `GET /api/rarity-tiers` → `RarityTierDTO[]` (ascending `minCp`)
  - Admin:
    - `GET /api/admin/guilds` → `AdminGuildDTO[]` (includes inactive)
    - `POST /api/admin/guilds` `{ name, iconUrl?, webhookUrl?, worldIds: number[] }` → 201 `AdminGuildDTO`
    - `PATCH /api/admin/guilds/:id` (any subset, including `active`) → `AdminGuildDTO`. `worldIds` replaces the set.
    - `POST /api/admin/worlds` `{ nexonWorldId, name, worldType }` → 201; `PATCH /api/admin/worlds/:id` `{ name?, worldType?, active? }`
    - `POST /api/admin/bosses` `{ name, imageUrl?, sortOrder?, difficulties: { difficulty, partyCap?, sortOrder? }[] }` → 201; `PATCH /api/admin/bosses/:id` (replaces difficulties by `difficulty` name: adds new ones, updates existing ones, and deletes missing ones only if no character references them, else 409 `IN_USE`); `DELETE /api/admin/bosses/:id` (409 `IN_USE` if referenced)
    - `PUT /api/admin/rarity-tiers` `{ tiers: { name, minCp, sortOrder }[] }` replaces all tiers. It requires one tier with `minCp: 0`, else 400 `NEEDS_BASE_TIER`.
  - Validation:
    - `webhookUrl` must match `^https://(discord|discordapp)\.com/api/webhooks/\d+/[\w-]+$`, else 400 `VALIDATION`.
    - A duplicate guild name returns 409 `DUPLICATE`.
    - Unknown `worldIds` return 400 `VALIDATION`.
  - `minCp` is sent and returned as a number. It's stored as BigInt.

- [ ] **Step 1:** Write the failing tests:
  - `non-admin cannot POST /api/admin/guilds → 403`; `visitor → 401`.
  - `admin creates guild with worlds`: `POST {name:'Moonlight', webhookUrl:'https://discord.com/api/webhooks/123/abc-DEF', worldIds:[kronos.id]}` returns 201 with `worldIds:[kronos.id]`.
  - **Review focus 4:** `GET /api/guilds` as a visitor and as a logged-in non-admin. Neither response contains the `webhookUrl` key on any guild (`expect(JSON.stringify(body)).not.toContain('webhooks')`).
  - `bad webhook url → 400`.
  - `PATCH active:false hides guild from GET /api/guilds but not /api/admin/guilds`.
  - `rarity tiers PUT then GET returns ascending; minCp 1_500_000_000 round-trips exactly`.
  - `PUT tiers without base → 400 NEEDS_BASE_TIER`.
  - `deleting a boss difficulty referenced by a CharacterBoss → 409 IN_USE`.
- [ ] **Step 2:** Run `npm test -w server -- catalog`. Expected: FAIL.
- [ ] **Step 3:** Implement `catalog/routes.ts`.
- [ ] **Step 4:** Run `npm test -w server -- catalog`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): catalog and admin management API`.

---

### Task 7: Image storage and upload validation

**Files:**
- Create: `server/src/storage/storage.ts`, `server/src/storage/imageType.ts`
- Modify: `server/src/app.ts` (register `@fastify/multipart` with `limits.fileSize = 5*1024*1024`; serve `GET /uploads/:key` from storage with the correct content-type and `Cache-Control: public, max-age=31536000, immutable`)
- Test: `server/test/storage.test.ts`

**Interfaces:**
- Produces:
  - `sniffImageType(buf: Buffer): 'png'|'jpg'|'webp'|null`. It checks magic bytes:
    - PNG: `89 50 4E 47 0D 0A 1A 0A`
    - JPG: `FF D8 FF`
    - WebP: `RIFF....WEBP`
  - `interface Storage { save(buf: Buffer, ext: 'png'|'jpg'|'webp'): Promise<string /* key */>; read(key: string): Promise<{ buf: Buffer; contentType: string } | null>; remove(key: string): Promise<void>; publicUrl(key: string): string /* `/uploads/${key}` */ }`
  - `class LocalDiskStorage implements Storage { constructor(dir: string) }`. Keys are `<random 24 hex>.<ext>`. `read` and `remove` reject keys not matching `^[a-f0-9]{24}\.(png|jpg|webp)$` (no path traversal).
  - `readImageUpload(req): Promise<{ buf: Buffer; ext }>` (in `imageType.ts`):
    - 400 `NO_FILE` if no file part.
    - 400 `FILE_TOO_LARGE` when multipart truncates.
    - 400 `UNSUPPORTED_IMAGE` when `sniffImageType` is null.
  - `AppDeps` gains `storage: Storage`.

- [ ] **Step 1:** Write the failing tests:
  - `sniff`: real 1×1 PNG, JPG, and WebP byte fixtures return the right types. `Buffer.from('hello')` returns null.
  - `LocalDiskStorage round-trip`: save, then read returns the same bytes and `image/png`. `read('../etc/passwd')` returns null.
  - **Review focus 3** (via a test-only route `POST /api/_test/upload` that calls `readImageUpload` then `storage.save`):
    - Text content named `x.png` gets 400 `UNSUPPORTED_IMAGE`.
    - A 6 MB buffer with a PNG header gets 400 `FILE_TOO_LARGE`.
    - In both cases the upload dir is still empty afterwards.
- [ ] **Step 2:** Run `npm test -w server -- storage`. Expected: FAIL.
- [ ] **Step 3:** Implement the storage module.
- [ ] **Step 4:** Run `npm test -w server -- storage`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): local image storage with signature validation`.

---

### Task 8: Characters API — lookup and create

**Files:**
- Create: `server/src/characters/routes.ts`, `server/src/characters/service.ts`, `server/src/characters/serialize.ts`
- Test: `server/test/characters.create.test.ts`

**Interfaces:**
- Consumes: `NexonClient`, `requireUser`, `getViewer`, `Storage.publicUrl`
- Produces:
  - `POST /api/characters/lookup` `{ ign }` (requires user) → `NexonCharacterPreview[]`. `worldName` comes from the `World` table by `nexonWorldId`, or null if unknown. Returns 502 `NEXON_UNAVAILABLE` on `NexonUnavailableError`.
  - `POST /api/characters` (requires user). The body is:

```ts
{ ign: string; nexonWorldId: number; combatPower: number /* int ≥1 */; guildId: string;
  bosses: { bossDifficultyId: number; experience: ExperienceLevel }[]; playTimes: number[] /* 0..167 unique */; note: string /* ≤ 300 chars */ }
```

  It calls Nexon again and picks the match with `nexonWorldId`. Possible results:
  - No match: 404 `CHARACTER_NOT_FOUND`
  - Nexon error: 502 `NEXON_UNAVAILABLE`, nothing written
  - World not in table: 400 `UNKNOWN_WORLD` with message `World <id> isn't set up yet — ask the admin`
  - World inactive: 400 `WORLD_INACTIVE`
  - Guild missing or inactive: 400 `GUILD_INACTIVE`
  - Duplicate `(ignLower, worldId)`: 409 `ALREADY_CLAIMED`
  - Success: 201 `CharacterDTO`

  On success, the stored `ign` is Nexon's casing, `cpUpdatedAt = lastSyncedAt = now`.
  - `toCharacterDTO(row, viewerUserId: string | null, storage): CharacterDTO` (in `serialize.ts`) returns `combatPower` as `Number(bigint)`, `owner.discordUsername` from the owner user, and `isOwner` by comparing to the viewer.
  - `characterInclude` is the Prisma `include` object (world, guild, owner, bosses → bossDifficulty → boss), exported for reuse.

- [ ] **Step 1:** Write the failing tests. In `beforeEach`, set up Kronos (nexon 45), an active guild, Hard Lucid, `FakeNexon.set([{ign:'Lily', nexonWorldId:45, level:279, jobName:'Angelic Buster', imageUrl:'https://msavatar1.nexon.net/x.png'}])`, and log in as `u-1`.
  - `lookup returns preview with worldName 'Kronos'`.
  - `create happy path`: 201. The body matches `{ ign:'Lily', level:279, jobName:'Angelic Buster', world:{name:'Kronos'}, guild:{id}, isOwner:true, owner:{discordUsername:'tester'}, bosses:[{bossName:'Lucid', difficulty:'Hard', experience:'can_carry'}] }`.
  - **Review focus 5:** `combatPower: 1_500_000_000` returns exactly `1500000000`.
  - **Review focus 1:** create with `ign:'lily'` stores `ign:'Lily'`. A second user creating `'LILY'` on world 45 gets 409 `ALREADY_CLAIMED`.
  - **Review focus 2:** `nexon.failNext()` makes create return 502 `NEXON_UNAVAILABLE`, and `prisma.character.count() === 0`.
  - `unknown world`: Nexon returns `nexonWorldId: 999` and the create gets 400 `UNKNOWN_WORLD`.
  - `inactive guild → 400 GUILD_INACTIVE`.
  - `visitor → 401`.
  - `playTimes [200] → 400 VALIDATION`.
- [ ] **Step 2:** Run `npm test -w server -- characters.create`. Expected: FAIL.
- [ ] **Step 3:** Implement the service, routes, and serializer. Wrap the create in a transaction, catch `P2002`, and return 409.
- [ ] **Step 4:** Run `npm test -w server -- characters.create`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): character lookup and create`.

---

### Task 9: Characters API — read, list, edit, delete, screenshot, refresh

**Files:**
- Modify: `server/src/characters/routes.ts`, `server/src/characters/service.ts`
- Test: `server/test/characters.manage.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/characters?guildId&worldId&archetype&q&mine=1` (public; `mine=1` requires user) → `CharacterDTO[]`:
    - `archetype` filters via `classToArchetype` (filtered in memory after the DB query, fine at guild scale).
    - `q` matches `ignLower` by prefix.
    - Only characters in active guilds are included, except with `mine=1`.
    - Sorted by `combatPower` descending.
  - `GET /api/characters/:id` (public) → `CharacterDTO` or 404.
  - `PATCH /api/characters/:id` (owner only, else 403 `NOT_OWNER`) `{ combatPower?, guildId?, bosses?, playTimes?, note? }` → `CharacterDTO`. Changing `combatPower` sets `cpUpdatedAt = now`. `bosses` replaces the set. Guild must be active.
  - `DELETE /api/characters/:id` (owner) → 204. Also removes its screenshot from storage. *(Plan 2 adds: blocked or soft-deleted when the character is in a party.)*
  - `PUT /api/characters/:id/screenshot` (owner, multipart field `file`) → `CharacterDTO`. Uses `readImageUpload` and deletes the previous key.
  - `POST /api/characters/:id/refresh` (owner) → `CharacterDTO`:
    - 429 `TOO_SOON` if `lastRefreshRequestedAt` is within 10 minutes.
    - Otherwise sets `lastRefreshRequestedAt = now` and calls `syncCharacterFromNexon`.
  - `syncCharacterFromNexon(prisma, nexon, characterId): Promise<'ok'|'stale'>` (in `service.ts`; Plan 3's daily job reuses it):
    - On match: updates level, jobName, imageUrl, `lastSyncedAt`, and sets `syncStatus: ok`.
    - On no match or `NexonUnavailableError`: leaves the data unchanged and sets `syncStatus: stale`.
    - Never throws on Nexon errors.

- [ ] **Step 1:** Write the failing tests:
  - `list sorted by CP desc and filters by guildId, worldId, archetype=pirate, q='li'`.
  - `list hides characters of inactive guilds`.
  - `GET by id as visitor → isOwner:false, includes owner.discordUsername`.
  - `PATCH by non-owner → 403 NOT_OWNER`.
  - `PATCH combatPower bumps cpUpdatedAt; PATCH note only does not`.
  - `PATCH bosses replaces set`.
  - `screenshot upload sets screenshotUrl '/uploads/<key>'; second upload removes first file`.
  - `refresh updates level from FakeNexon (279→280)`.
  - `second refresh within 10 min → 429 TOO_SOON`.
  - **Review focus 2:** after `nexon.failNext()`, refresh returns 200 with the old level and `syncStatus:'stale'`. The next successful refresh (after moving `lastRefreshRequestedAt` back in the DB) sets it back to `'ok'`.
  - `DELETE removes row and screenshot file`.
- [ ] **Step 2:** Run `npm test -w server -- characters.manage`. Expected: FAIL.
- [ ] **Step 3:** Implement the routes and service functions above.
- [ ] **Step 4:** Run `npm test -w server`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(server): character read, edit, delete, screenshot, refresh`.

---

### Task 10: Web scaffold, API client, auth state, layout

**Files:**
- Create: `web/package.json`, `web/index.html`, `web/vite.config.ts` (dev proxy `/api` and `/uploads` → `http://localhost:3000`; Vitest jsdom env), `web/tsconfig.json`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/api/client.ts`, `web/src/api/hooks.ts`, `web/src/components/Layout.tsx`, `web/src/styles/global.css`, `web/test/setup.ts`
- Test: `web/test/layout.test.tsx`

**Interfaces:**
- Produces:
  - `api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T>`. It sends `credentials: 'include'` and sets the JSON body and header. On non-2xx it throws `ApiError { status: number; code: string; message: string }`. On 204 it returns `undefined`.
  - Hooks (TanStack Query):
    - `useMe()`
    - `useWorlds()`, `useGuilds()`, `useBosses()`, `useRarityTiers()` (staleTime 5 min)
    - `useCharacters(filters)`, `useCharacter(id)`
    - Mutations: `useCreateCharacter()`, `useUpdateCharacter(id)`, `useDeleteCharacter()`, `useUploadScreenshot(id)`, `useRefreshCharacter(id)`, each invalidating `['characters']`
  - Routes in `App.tsx`:
    - `/` → `CharactersPage`
    - `/me/characters` → `MyCharactersPage`
    - `/me/characters/new` → `CharacterFormPage`
    - `/me/characters/:id/edit` → `CharacterFormPage`
    - `/admin/*` → admin pages (Task 13)
    - Pages not built yet render a placeholder.
  - `Layout`:
    - **Header:** app name, nav ("Characters", "My characters" when logged in, "Admin" when `isAdmin`), and either a "Log in with Discord" link to `/api/auth/discord` or the Discord avatar, username, and "Log out".
    - Below 640px the nav collapses into a menu button.
  - CSS tokens on `:root` with a dark-mode variant via `prefers-color-scheme`.
  - Test setup: `renderWithProviders(ui, { route?: string })` in `web/test/setup.ts`, and a `mockApi(routes: Record<string, unknown | ((init) => unknown)>)` helper that stubs `fetch`.

- [ ] **Step 1:** Write the failing tests:
  - `logged out shows Log in with Discord linking /api/auth/discord`: mock `/api/auth/me` → `null`.
  - `logged in shows username and My characters, no Admin`.
  - `admin sees Admin link`.
- [ ] **Step 2:** Run `npm test -w web`. Expected: FAIL.
- [ ] **Step 3:** Implement the scaffold, client, hooks, and layout.
- [ ] **Step 4:** Run `npm test -w web`. Expected: PASS. Also start the server and web dev servers and open `http://localhost:5173`. Expected: the header renders and the login button redirects to Discord (with real Discord app credentials in `.env`).
- [ ] **Step 5:** Commit: `feat(web): scaffold, API client, auth-aware layout`.

---

### Task 11: CharacterCard and CardDetailModal

**Files:**
- Create: `web/src/components/card/CharacterCard.tsx`, `web/src/components/card/card.css`, `web/src/components/card/CardDetailModal.tsx`, `web/src/components/card/format.ts`
- Test: `web/test/card.test.tsx`

**Interfaces:**
- Consumes: `CharacterDTO`, `classToArchetype`, `rarityFor`, `utcHoursToLocalHours`, `EXPERIENCE_LABELS`, `useRarityTiers()`
- Produces:
  - `formatCp(n: number): string`: `1_500_000_000 → '1.5B'`, `12_345_678 → '12.3M'`, `950_000 → '950K'`, `999 → '999'`.
  - `<CharacterCard character={CharacterDTO} tiers={RarityTierDTO[]} bossContext?: { bossDifficultyId: number; label: string }[] onOpen?: () => void />`:
    - **Root element:** `role="button"` with an `aria-label` of `"<IGN>, level <level> <jobName>"`, and classes `card card--<archetype> card--rank-<rank>`, plus `card--foil` when `isTop`.
    - **Layout, top to bottom:** IGN and "Lv. 279", the art window (`<img alt="<IGN>">`), a stats box (class, CP via `formatCp`, guild, world), and a footer with the Discord username.
    - **Rarity:** the tier name is shown as a small badge.
    - **Boss context:** when `bossContext` is given, it renders one badge per entry: `<label>: <EXPERIENCE_LABELS[exp]>` or `<label>: not listed`.
    - **Opening:** Enter, Space, or click calls `onOpen`.
    - **Visuals in `card.css`:**
      - Archetype frame colors.
      - Xenon frame: a diagonal purple/gold split gradient.
      - Foil: an animated holographic gradient overlay that runs on hover and is disabled under `prefers-reduced-motion`.
      - Card aspect ratio 63:88 (trading card).
  - `<CardDetailModal character={CharacterDTO} tiers onClose onEdit?: () => void />`:
    - Uses `<dialog>` with `aria-modal`, and closes on Esc or backdrop click.
    - Shows the card, the screenshot (click to open full size in a new tab, or "No Scouter screenshot yet"), Discord username with a copy button, bosses grouped by boss with difficulty and experience, play times as a read-only grid in the viewer's local time, the note, and `"CP updated N days ago"`.
    - Shows a "Stale: couldn't sync from Nexon" notice when `syncStatus === 'stale'`.
    - The "Edit" button shows only when `character.isOwner && onEdit`.

- [ ] **Step 1:** Write the failing tests:
  - `formatCp` cases above.
  - `card applies archetype and foil classes`: Angelic Buster with CP 1.5B and tiers `[0, 20M, 400M]` gets `card--pirate`, `card--rank-2`, and `card--foil`. It shows `1.5B` and `Lv. 279`.
  - `xenon gets card--xenon`; `unknown class gets card--unknown`.
  - `boss context badges`: context `[{bossDifficultyId:1,label:'Hard Lucid'},{bossDifficultyId:2,label:'Hard Will'}]` on a character with only `{bossDifficultyId:1, experience:'can_carry'}` renders `Hard Lucid: Can teach/carry` and `Hard Will: not listed`.
  - `Enter opens`: `onOpen` is called once.
  - `modal shows discord username, note, screenshot img; Edit only for owner`.
  - `modal stale notice`.
- [ ] **Step 2:** Run `npm test -w web -- card`. Expected: FAIL.
- [ ] **Step 3:** Implement the components and styles.
- [ ] **Step 4:** Run `npm test -w web -- card`. Expected: PASS. Visually check the cards at 375px and 1280px widths in the dev server, using seeded characters from Task 14 or fixtures.
- [ ] **Step 5:** Commit: `feat(web): Pokémon-style character card and detail modal`.

---

### Task 12: Character pages (browse, my characters, add/edit)

**Files:**
- Create: `web/src/pages/CharactersPage.tsx`, `web/src/pages/MyCharactersPage.tsx`, `web/src/pages/CharacterFormPage.tsx`, `web/src/components/PlayTimeGrid.tsx`, `web/src/components/BossExperiencePicker.tsx`
- Test: `web/test/characterPages.test.tsx`

**Interfaces:**
- Consumes: the hooks from Task 10, the components from Task 11, `localHoursToUtcHours`/`utcHoursToLocalHours`
- Produces:
  - `CharactersPage`:
    - A filter bar: guild select, world select, archetype select, and an IGN search box (debounced 300 ms).
    - A responsive card grid: `repeat(auto-fill, minmax(220px, 1fr))`, with two columns on phones.
    - Clicking a card opens `CardDetailModal`.
  - `MyCharactersPage`: requires login, otherwise shows the login prompt. Lists my cards, each with "Edit", "Refresh from Nexon" (shows a `TOO_SOON` message), and "Delete" (with a confirm). Has an "Add character" button.
  - `CharacterFormPage`:
    - **Add mode:**
      - Step 1: the user enters an IGN and clicks "Find". The page shows the lookup previews as mini cards. With several matches the user picks the world; with one it's preselected; an `UNKNOWN_WORLD` preview shows as disabled with the admin message.
      - Step 2: the form fields: CP (numeric input; commas allowed and stripped), guild (from `useGuilds`), the bosses picker, play times, a note (300-character counter), and a screenshot file input (uploaded right after the create succeeds).
    - **Edit mode:** the same step-2 form, prefilled.
    - Server error codes are mapped to friendly messages: `ALREADY_CLAIMED` → "This character is already claimed. Contact the admin if it's yours."; `NEXON_UNAVAILABLE` → "Couldn't reach Nexon. Try again in a minute."
  - `<BossExperiencePicker value onChange bosses={BossDTO[]} />`: one row per boss, with a difficulty multi-select. Each selected difficulty gets an experience select (Learning / Cleared before / Can teach/carry). The value is `{ bossDifficultyId, experience }[]`.
  - `<PlayTimeGrid value={number[] /* UTC hours */} onChange? readOnly? />`: a 7-day × 24-hour grid in local time (column per day, row per hour, labeled "Sun"…"Sat" and "12a"…"11p"), converted with the browser's `getTimezoneOffset()`. Click-and-drag selects a range of hours; on phones it scrolls vertically inside its own container.

- [ ] **Step 1:** Write the failing tests:
  - `browse renders cards from /api/characters and filtering by guild refetches with ?guildId=`.
  - `add flow`: type `Lily`, Find, select the Kronos preview, enter CP `1,500,000,000`, pick guild, pick `Hard Lucid` = `Can teach/carry`, click hours Sun 8p and Sun 9p, Save. The POST body has `combatPower: 1500000000` and `bosses: [{bossDifficultyId, experience:'can_carry'}]`, and `playTimes` equals `localHoursToUtcHours([{day:0,hour:20},{day:0,hour:21}], new Date().getTimezoneOffset())`.
  - `ALREADY_CLAIMED shows friendly message`.
  - `edit mode prefills CP and note`.
- [ ] **Step 2:** Run `npm test -w web -- characterPages`. Expected: FAIL.
- [ ] **Step 3:** Implement the pages and components.
- [ ] **Step 4:** Run `npm test -w web`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(web): browse, my characters, add/edit character`.

---

### Task 13: Admin pages

**Files:**
- Create: `web/src/pages/admin/AdminLayout.tsx`, `web/src/pages/admin/GuildsAdmin.tsx`, `web/src/pages/admin/WorldsAdmin.tsx`, `web/src/pages/admin/BossesAdmin.tsx`, `web/src/pages/admin/TiersAdmin.tsx`
- Modify: `web/src/api/hooks.ts` (admin hooks)
- Test: `web/test/admin.test.tsx`

**Interfaces:**
- Consumes: the admin API from Task 6
- Produces:
  - `AdminLayout` shows "Not authorized" unless `me.isAdmin`. It has tabs for Guilds / Worlds / Bosses / Rarity tiers.
  - `GuildsAdmin`: a table (name, worlds, webhook set ✓/—, active toggle) and a create/edit form (name, icon URL, webhook URL, world checkboxes). The webhook field is a password-style input with a reveal toggle. *(Plan 3 adds a "Send test message" button.)*
  - `WorldsAdmin`: a table plus add/edit (Nexon world ID, name, Heroic/Interactive, active).
  - `BossesAdmin`: a list of bosses with editable difficulty rows (difficulty, party cap). Shows the `IN_USE` error inline.
  - `TiersAdmin`: editable rows (name, min CP, order). Saving calls `PUT`. Shows `NEEDS_BASE_TIER` inline. A live preview renders the sample card at each tier's `minCp`.

- [ ] **Step 1:** Write the failing tests:
  - `non-admin sees Not authorized`.
  - `create guild posts worldIds from checked boxes`.
  - `tiers save sends PUT with numeric minCp and shows NEEDS_BASE_TIER error`.
- [ ] **Step 2:** Run `npm test -w web -- admin`. Expected: FAIL.
- [ ] **Step 3:** Implement the admin pages.
- [ ] **Step 4:** Run `npm test -w web -- admin`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): admin pages for guilds, worlds, bosses, tiers`.

---

### Task 14: Seed data and production Docker

**Files:**
- Create: `server/prisma/seed.ts`, `server/Dockerfile`, `docker-compose.prod.yml`, `README.md`
- Modify: `server/package.json` (`"prisma": { "seed": "tsx prisma/seed.ts" }`; `build` uses `tsup src/index.ts --format esm --noExternal @pf/shared`), `server/src/app.ts` (in production, serve `web/dist` statically with SPA fallback for non-`/api`, non-`/uploads` paths)
- Test: `server/test/seed.test.ts`

**Interfaces:**
- Produces: `seed(prisma): Promise<void>`. It's idempotent (upserts by unique keys) and inserts:
  - **Worlds** (verified IDs 2026-11-09; names are best known, so confirm against the rankings page world filter and fix in admin if wrong):
    - `{1,'Bera',interactive}`
    - `{19,'Scania',interactive}`
    - `{45,'Kronos',heroic}`
    - `{70,'Hyperion',heroic}`
  - **Rarity tiers:** Common 0 · Rare 20,000,000 · Epic 60,000,000 · Unique 150,000,000 · Legendary 400,000,000 (sortOrder 0–4).
  - **Bosses** (partyCap 6 unless the admin changes it):
    - Zakum (Chaos); Magnus (Hard); Hilla (Hard); Pink Bean (Chaos)
    - Cygnus (Easy, Normal); Pierre, Von Bon, Crimson Queen, Vellum (each Chaos); Papulatus (Chaos)
    - Lotus (Normal, Hard, Extreme); Damien (Normal, Hard); Guardian Angel Slime (Normal, Chaos)
    - Lucid (Easy, Normal, Hard); Will (Easy, Normal, Hard); Gloom (Normal, Chaos)
    - Verus Hilla (Normal, Hard); Darknell (Normal, Hard); Black Mage (Hard, Extreme)
    - Chosen Seren (Normal, Hard, Extreme); Kalos the Guardian (Easy, Normal, Chaos, Extreme)
    - Kaling (Easy, Normal, Hard, Extreme); First Adversary (Easy, Normal, Hard, Extreme)
    - Limbo (Normal, Hard); Baldrix (Normal, Hard)
  - The production stack:
    - `docker-compose.prod.yml` has services `db` (postgres:16, volume `pgdata`) and `app`.
    - `app` is built from the multi-stage `server/Dockerfile`: build `shared`, `web`, `server`, then copy `web/dist` and the server bundle. On start it runs `prisma migrate deploy && prisma db seed && node dist/index.js`. It mounts volume `uploads` at `/data/uploads` (`UPLOAD_DIR=/data/uploads`), maps port `3000`, and reads its env from `.env`.
  - `README.md` covers: creating the Discord application (redirect URI `<origin>/api/auth/discord/callback`, scope `identify`), the env vars (from `.env.example`), dev (`npm run dev:db`, `npm run dev -w server`, `npm run dev -w web`), tests, and production (`docker compose -f docker-compose.prod.yml up -d --build`).

- [ ] **Step 1:** Write the failing test `seed.test.ts`. It runs `seed()` twice, then asserts 4 worlds, 5 tiers, `Lucid` with 3 difficulties, and no duplicates.
- [ ] **Step 2:** Run `npm test -w server -- seed`. Expected: FAIL.
- [ ] **Step 3:** Implement the seed, Dockerfile, prod compose, static serving, and README.
- [ ] **Step 4:** Run `npm test -w server -- seed`. Expected: PASS.
- [ ] **Step 5:** Run `docker compose -f docker-compose.prod.yml up -d --build`, then `curl -s localhost:3000/api/health`. Expected: `{"ok":true}`, and `curl -s localhost:3000/api/worlds` lists Kronos. Open `http://localhost:3000`. Expected: the app loads and login works with real Discord credentials. Then add a real character and confirm the card renders with its Nexon image.
- [ ] **Step 6:** Run `npm test` at the root. Expected: all workspaces PASS.
- [ ] **Step 7:** Commit: `feat: seed data and production Docker setup`.

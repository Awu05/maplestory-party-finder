# Party Finder — Plan 2: Posts, Requests, Parties

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players can post (and edit their own posts) "Looking for party" or "Recruiting" for one or more bosses, request to join and invite each other, and accept or decline. They build a party lineup for planning and see their current and past parties under "My parties". Party records survive closing, expiry, post deletion, and character deletion.

**Architecture:** Builds on Plan 1's monorepo:
- **Server:** two new modules, `server/src/posts/` (posts, members, lifecycle) and `server/src/requests/` (join requests and invites). They share serializers, a `memberSnapshot()` helper, and a `DomainEvents` sink added to `AppDeps`. Every state change emits a typed event after commit; Plan 3 turns those events into notifications and Discord messages. Here a no-op sink is the default and a recording sink is used in tests.
- **Expiry:** expired posts are computed lazily from `expiresAt` (no background job).
- **Accept races:** an accept locks the post row with `SELECT … FOR UPDATE` inside a transaction, so two accepts can't overfill a party.
- **Web:** new board, post, and "My parties" pages reuse `CharacterCard`.

**Tech Stack:** Same as Plan 1: Fastify 5, Prisma 6, Postgres 16, Zod 4, Vitest, React 18, React Router 6, TanStack Query 5, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-09-party-finder-design.md` (§6, §12, §14 are the core; §7 events feed Plan 3). Plan 1 follow-ups: `docs/superpowers/plans/2026-11-09-party-finder-1-followups.md`.

## Global Constraints

- **Post types:** `lfp` ("Looking for party") and `recruiting` ("Recruiting").
- **Bosses:** a post has 1–10 unique (boss, difficulty) entries from the admin boss list.
- **When:** a specific time (`scheduledAt`, stored in UTC and shown in the viewer's time zone) or "Flexible" (`scheduledAt = null`).
- **Party size:** Recruiting only. Total size includes the poster: an integer 2–6 and ≤ the smallest `partyCap` among the post's bosses. LFP posts must not send `partySize` or `minCp`.
- **Minimum CP:** optional on Recruiting posts and informational only. Applicants below it see a warning but can still apply.
- **Expiry:** `expiresAt = scheduledAt + 3h` for scheduled posts, and `createdAt + 7 days` for flexible posts. The poster can renew a flexible post, which sets `expiresAt = now + 7 days`.
- **Scheduled times:** `scheduledAt` must be no earlier than 5 minutes before now and no more than 30 days ahead.
- **Effective status:** `closed` if the post is deleted, closed, or `expiresAt <= now`; otherwise `full` or `open` as stored. The board shows only effective-`open`, non-deleted posts.
- **World rules:**
  - Every post has the world of the poster's character.
  - Join requests and invites only allow characters on the post's world (`WRONG_WORLD`).
  - The board defaults to the worlds of the viewer's characters.
- **Requests:** only one pending request or invite per (post, character). A declined or cancelled request can be re-sent.
- **When a Recruiting post fills:** status becomes `full` and its pending requests and invites are auto-declined.
- **When a member leaves or is removed from a full post:** it reopens, unless it is expired or deleted.
- **When an LFP poster accepts an invite:** their LFP post closes (reason `lfp_matched`), and that LFP post's other pending invites are auto-declined.
- **One character, many parties:** a character may be in several lineups and have several open posts. The app doesn't block overlapping times; the web shows a soft warning when a character is already in a party within 3 hours of the post's time.
- **Editing:** only the poster can edit their post, and they can change any field under Task 8's rules. Type and character are locked once others have joined, and party size can't drop below the current member count.
- **Deleting posts:**
  - The poster can close or delete their own post at any time.
  - Delete with no accepted members (only the poster in the lineup) removes the post entirely.
  - Delete with accepted members sets `deletedAt` (soft delete). The post disappears from the board and stops taking requests, but the party record stays.
- **Team comps never disappear:** the poster and every accepted member keep the party record (bosses, time, lineup), whatever happens to the post or a character. Lineup cards show current character data plus the CP the character had when they joined. If a character is deleted, its snapshot shows instead.
- **Who can see closed and deleted posts:** only the poster, members, and the admin. Everyone else gets 404. The admin can hard-delete any post.
- **Times:** stored in UTC, shown in local time. The board is newest first.
- **Layout:** must work at phone width.
- **Error codes** (all `{ error: { code, message } }`):

| Code | Status |
|---|---|
| `VALIDATION` | 400 |
| `WRONG_WORLD` | 400 |
| `NOT_OWNER` | 403 |
| `NOT_ALLOWED` | 403 |
| `NOT_FOUND` | 404 |
| `POST_CLOSED` | 409 |
| `POST_FULL` | 409 |
| `ALREADY_MEMBER` | 409 |
| `ALREADY_PENDING` | 409 |
| `NOT_PENDING` | 409 |
| `CANNOT_LEAVE_OWN_POST` | 409 |
| `NOT_FLEXIBLE` | 409 |
| `PARTY_TOO_SMALL` | 409 |
| `HAS_MEMBERS` | 409 |
| `WRONG_POST_TYPE` | 409 |
| `GUILD_INACTIVE` | 400 |
| `WORLD_INACTIVE` | 400 |

## Review Focus

1. **Two accepts race for the last slot.** The party never exceeds `partySize`: one accept succeeds and the other gets 409 `POST_FULL`. (Test in Task 5.)
2. **A post that expired while its stored status still says `open`.** It is not on the board, and requests and accepts on it return 409 `POST_CLOSED`. (Tests in Task 3 and Task 5.)
3. **The poster deletes a post that has members.** It is gone from the board, still in every member's "My parties" with its full lineup, and returns 404 to non-members. (Test in Task 4.)
4. **A character in a party is deleted.** The party view shows its snapshot (IGN, class, level, CP at join), not a crash. Its open posts close, and its pending requests disappear. (Test in Task 7.)
5. **Bad request attempts.** A character from another world, someone else's character, an existing member, or a duplicate pending request returns 400 `WRONG_WORLD`, 403 `NOT_OWNER`, 409 `ALREADY_MEMBER`, or 409 `ALREADY_PENDING`. (Tests in Task 5.)

---

## File Structure

```
server/prisma/schema.prisma            # + Post, PostBoss, PostMember, Request, enums
server/prisma/migrations/<ts>_posts/   # + partial unique index (raw SQL)
server/src/events.ts                   # DomainEvent union, DomainEvents, NoopEvents
server/src/posts/snapshot.ts           # memberSnapshot()
server/src/posts/serialize.ts          # postInclude, toPostSummaryDTO, toPostDetailDTO, toMemberDTO
server/src/posts/service.ts            # create, list, get-visible, close, delete, renew, leave/remove, mine
server/src/posts/routes.ts
server/src/requests/service.ts         # create join/invite, accept, decline, cancel, list mine
server/src/requests/serialize.ts       # requestInclude, toRequestDTO
server/src/requests/routes.ts
server/src/characters/service.ts       # (modify) deleteCharacter closes posts / keeps snapshots
server/src/catalog/routes.ts           # (modify) IN_USE also counts PostBoss
server/test/helpers.ts                 # + RecordingEvents, makePost, makeRecruitingSetup
server/test/posts.*.test.ts, requests.*.test.ts
shared/src/posts.ts                    # constants, postExpiresAt, effectivePostStatus
shared/src/types.ts                    # + post/request DTOs
web/src/api/postHooks.ts               # post/request/party hooks
web/src/components/post/PostCard.tsx + post.css
web/src/components/post/BossMultiPicker.tsx
web/src/components/post/LineupView.tsx
web/src/components/post/CharacterPicker.tsx
web/src/components/post/time.ts        # formatWhen, toUtcIso, overlap helper
web/src/pages/BoardPage.tsx
web/src/pages/NewPostPage.tsx
web/src/pages/PostDetailPage.tsx
web/src/pages/MyPartiesPage.tsx
web/src/App.tsx, web/src/components/Layout.tsx   # (modify) routes and nav
web/test/*.test.tsx
```

---

### Task 1: Schema, events sink, and test helpers

**Files:**
- Modify: `server/prisma/schema.prisma`, `server/src/app.ts` (AppDeps), `server/src/index.ts`, `server/test/helpers.ts`, `server/src/catalog/routes.ts` (IN_USE check)
- Create: `server/prisma/migrations/<timestamp>_posts/migration.sql` (generated, then append the partial index), `server/src/events.ts`
- Test: `server/test/posts.schema.test.ts`

**Interfaces:**
- Consumes: Plan 1 schema, `makeCharacter` / `makeBossDifficulty` / `makeUser` factories, and the `buildTestApp` helper.
- Produces (Prisma):

```prisma
enum PostType { lfp recruiting }
enum PostStatus { open full closed }
enum RequestKind { join_request invite }
enum RequestStatus { pending accepted declined cancelled }
enum MemberRole { poster member }

model Post {
  id                String     @id @default(cuid())
  type              PostType
  posterUserId      String
  posterUser        User       @relation(fields: [posterUserId], references: [id])
  posterCharacterId String?
  posterCharacter   Character? @relation("PostPoster", fields: [posterCharacterId], references: [id], onDelete: SetNull)
  worldId           Int
  world             World      @relation(fields: [worldId], references: [id])
  guildId           String
  guild             Guild      @relation(fields: [guildId], references: [id])
  scheduledAt       DateTime?
  expiresAt         DateTime
  partySize         Int?
  minCp             BigInt?
  note              String     @default("")
  status            PostStatus @default(open)
  closedReason      String?    // manual | full | lfp_matched | character_deleted
  deletedAt         DateTime?
  createdAt         DateTime   @default(now())
  bosses            PostBoss[]
  members           PostMember[]
  requests          Request[]  @relation("RequestPost")
  lfpInvites        Request[]  @relation("RequestLfpPost")
  @@index([status, expiresAt])
}
model PostBoss {
  postId           String
  post             Post           @relation(fields: [postId], references: [id], onDelete: Cascade)
  bossDifficultyId Int
  bossDifficulty   BossDifficulty @relation(fields: [bossDifficultyId], references: [id])
  @@id([postId, bossDifficultyId])
}
model PostMember {
  id          String     @id @default(cuid())
  postId      String
  post        Post       @relation(fields: [postId], references: [id], onDelete: Cascade)
  characterId String?
  character   Character? @relation(fields: [characterId], references: [id], onDelete: SetNull)
  userId      String
  user        User       @relation(fields: [userId], references: [id])
  role        MemberRole
  cpAtJoin    BigInt
  snapshot    Json       // MemberSnapshot
  joinedAt    DateTime   @default(now())
  @@unique([postId, characterId])
  @@index([userId])
}
model Request {
  id              String        @id @default(cuid())
  kind            RequestKind
  status          RequestStatus @default(pending)
  postId          String        // always the Recruiting post
  post            Post          @relation("RequestPost", fields: [postId], references: [id], onDelete: Cascade)
  characterId     String        // applicant (join_request) or invitee (invite)
  character       Character     @relation(fields: [characterId], references: [id], onDelete: Cascade)
  lfpPostId       String?       // invite only: the LFP post the invite answers
  lfpPost         Post?         @relation("RequestLfpPost", fields: [lfpPostId], references: [id], onDelete: SetNull)
  createdByUserId String
  createdAt       DateTime      @default(now())
  decidedAt       DateTime?
  @@index([characterId, status])
}
```

  Add the back-relations on `User`, `Character`, `World`, `Guild`, and `BossDifficulty`. Append this to the migration SQL:

  `CREATE UNIQUE INDEX "Request_one_pending" ON "Request"("postId", "characterId") WHERE "status" = 'pending';`

- Produces (`server/src/events.ts`):

```ts
export type PostClosedReason = 'manual' | 'full' | 'lfp_matched' | 'character_deleted' | 'deleted' | 'banned';
export type DomainEvent =
  | { type: 'post.created'; postId: string }
  | { type: 'post.updated'; postId: string }
  | { type: 'post.closed'; postId: string; reason: PostClosedReason }
  | { type: 'post.reopened'; postId: string }
  | { type: 'request.created'; requestId: string }
  | { type: 'request.accepted'; requestId: string }
  | { type: 'request.declined'; requestId: string; auto: boolean }
  | { type: 'request.cancelled'; requestId: string }
  | { type: 'member.left'; postId: string; memberId: string; userId: string; ign: string; removedBy: 'self' | 'poster' };
export interface DomainEvents { emit(event: DomainEvent): void }
export class NoopEvents implements DomainEvents { emit(): void {} }
```

- `AppDeps` gains `events: DomainEvents`. `index.ts` passes `new NoopEvents()`. `buildTestApp` defaults to a `RecordingEvents` (with `events: DomainEvent[]` and `clear()`) and returns it as `events`.
- New test factories:
  - `makePost(over?: Partial<Prisma.PostUncheckedCreateInput> & { bossDifficultyIds?: number[] }) → Post`. It creates a poster character if needed and inserts the poster `PostMember` row with its snapshot. Defaults: recruiting, `partySize: 4`, scheduled 1 day ahead, `expiresAt` per the rules.
  - `addMember(postId, characterId) → PostMember`.
- In `catalog/routes.ts`, the boss-difficulty `IN_USE` checks also count `PostBoss` references.

- [ ] **Step 1: Write the failing tests** in `posts.schema.test.ts`:
  - `two pending requests for same post+character violate Request_one_pending`: the second create rejects with P2002.
  - `a declined request does not block a new pending one`.
  - `deleting a character nulls PostMember.characterId and Post.posterCharacterId but keeps rows and snapshot`.
  - `deleting a boss difficulty used by a post → 409 IN_USE` (through the admin API).
- [ ] **Step 2:** Run `npm test -w server -- posts.schema`. Expected: FAIL (no Post model).
- [ ] **Step 3: Implement.** Edit the schema, then run `npx -w server prisma migrate dev --name posts` against the dev DB. Append the partial index to the generated `migration.sql`, then run `npx -w server prisma migrate reset --force` on the dev DB so the edited migration applies cleanly. Add `events.ts`, the AppDeps wiring, the helpers, and the catalog IN_USE change.
- [ ] **Step 4:** Run `npm test` (root). Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(db): posts, members, requests schema and domain events sink`.

---

### Task 2: Shared post rules and DTOs

**Files:**
- Create: `shared/src/posts.ts`
- Modify: `shared/src/types.ts`, `shared/src/index.ts`
- Test: `shared/test/posts.test.ts`

**Interfaces:**
- Produces (`posts.ts`):
  - Constants:
    - `SCHEDULED_GRACE_MS = 3 * 3600_000`
    - `FLEXIBLE_TTL_MS = 7 * 86_400_000`
    - `MAX_PARTY_SIZE = 6`
    - `MIN_PARTY_SIZE = 2`
    - `MAX_SCHEDULE_AHEAD_MS = 30 * 86_400_000`
    - `SCHEDULE_PAST_TOLERANCE_MS = 5 * 60_000`
    - `OVERLAP_WINDOW_MS = 3 * 3600_000`
    - `MAX_POST_BOSSES = 10`
  - `postExpiresAt(scheduledAt: Date | null, createdAt: Date): Date`
  - `effectivePostStatus(p: { status: 'open'|'full'|'closed'; expiresAt: Date | string; deletedAt: Date | string | null }, now: Date): 'open'|'full'|'closed'`
  - `maxPartySizeFor(partyCaps: number[]): number`. Returns `Math.min(MAX_PARTY_SIZE, ...partyCaps)`, or `MAX_PARTY_SIZE` when the list is empty.
- Produces (`types.ts`):

```ts
export type PostType = 'lfp' | 'recruiting';
export type PostStatus = 'open' | 'full' | 'closed';
export type RequestKind = 'join_request' | 'invite';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export const POST_TYPE_LABELS: Record<PostType, string> = { lfp: 'Looking for party', recruiting: 'Recruiting' };
export interface PostBossDTO { bossDifficultyId: number; bossName: string; difficulty: string }
export interface MemberSnapshot { ign: string; jobName: string; level: number; imageUrl: string; worldName: string; guildName: string }
export interface PartyMemberDTO {
  id: string; role: 'poster' | 'member'; characterId: string | null;
  cpAtJoin: number; joinedAt: string;
  character: CharacterDTO | null;   // null once the character is deleted
  snapshot: MemberSnapshot;
  isMine: boolean;
}
export interface PostSummaryDTO {
  id: string; type: PostType; world: { id: number; name: string }; guild: { id: string; name: string };
  poster: PartyMemberDTO; bosses: PostBossDTO[];
  scheduledAt: string | null; expiresAt: string; createdAt: string;
  partySize: number | null; memberCount: number; minCp: number | null; note: string;
  status: PostStatus;  // effective
  deleted: boolean; isPoster: boolean;
}
export interface RequestDTO {
  id: string; kind: RequestKind; status: RequestStatus; postId: string; lfpPostId: string | null;
  character: CharacterDTO; createdAt: string; decidedAt: string | null;
}
export interface PostDetailDTO extends PostSummaryDTO {
  members: PartyMemberDTO[];      // poster first, then by joinedAt
  isMember: boolean;
  incomingRequests: RequestDTO[]; // poster only: pending join requests
  sentInvites: RequestDTO[];      // poster only: pending invites from this recruiting post
  myPending: RequestDTO[];        // viewer's own pending join requests/invites involving this post
}
export interface RequestWithPostDTO extends RequestDTO { post: PostSummaryDTO }
export interface MyRequestsDTO { incomingInvites: RequestWithPostDTO[]; outgoingRequests: RequestWithPostDTO[] }
```

- [ ] **Step 1: Write the failing tests:**

```ts
const t0 = new Date('2026-11-10T00:00:00Z');
expect(postExpiresAt(t0, new Date('2026-11-09T00:00:00Z')).toISOString()).toBe('2026-11-10T03:00:00.000Z');
expect(postExpiresAt(null, t0).toISOString()).toBe('2026-11-17T00:00:00.000Z');
const base = { status: 'open' as const, expiresAt: '2026-11-10T03:00:00Z', deletedAt: null };
expect(effectivePostStatus(base, new Date('2026-11-10T02:59:59Z'))).toBe('open');
expect(effectivePostStatus(base, new Date('2026-11-10T03:00:00Z'))).toBe('closed');
expect(effectivePostStatus({ ...base, status: 'full' }, new Date('2026-11-10T01:00:00Z'))).toBe('full');
expect(effectivePostStatus({ ...base, deletedAt: '2026-11-09T00:00:00Z' }, new Date('2026-11-09T01:00:00Z'))).toBe('closed');
expect(maxPartySizeFor([6, 3, 6])).toBe(3);
expect(maxPartySizeFor([])).toBe(6);
expect(maxPartySizeFor([10])).toBe(6);
```

- [ ] **Step 2:** Run `npm test -w shared -- posts`. Expected: FAIL.
- [ ] **Step 3:** Implement and re-export from `index.ts`.
- [ ] **Step 4:** Run `npm test -w shared`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(shared): post lifecycle rules and post/request DTOs`.

---

### Task 3: Posts API — create, board, detail

**Files:**
- Create: `server/src/posts/snapshot.ts`, `server/src/posts/serialize.ts`, `server/src/posts/service.ts`, `server/src/posts/routes.ts`
- Modify: `server/src/app.ts` (register routes)
- Test: `server/test/posts.create.test.ts`, `server/test/posts.board.test.ts`

**Interfaces:**
- Consumes:
  - `characterInclude`, `CharacterRow`, `toCharacterDTO`, `getOwnedCharacter` (Plan 1).
  - `requireUser`, `getViewer`, `AppError`.
  - `postExpiresAt`, `effectivePostStatus`, `maxPartySizeFor`, and the constants from `@pf/shared`.
  - `DomainEvents`.
- Produces:
  - `memberSnapshot(row: CharacterRow): MemberSnapshot`
  - `postInclude`: world, guild (`select` id+name only, **never webhookUrl**), bosses → bossDifficulty → boss, members → character (`characterInclude`), ordered by `joinedAt`
  - `PostRow`
  - `toPostSummaryDTO(row: PostRow, viewerUserId: string | null, storage, now: Date): PostSummaryDTO`. `memberCount` = number of member rows; `poster` = the member row with role `poster`.
  - `toMemberDTO(m, viewerUserId, storage): PartyMemberDTO`
  - Routes:
    - `POST /api/posts` (requires user). The body is:

```ts
{ type: PostType; characterId: string; bossDifficultyIds: number[] /* 1..10 unique, exist */;
  scheduledAt: string | null /* ISO */; partySize?: number; minCp?: number /* int ≥ 1 */; note: string /* ≤ 300 */ }
```

      The character must be owned by the viewer (403 `NOT_OWNER`) and its guild and world must be active (400 `GUILD_INACTIVE` / `WORLD_INACTIVE`). The time window is validated per Global Constraints (400 `VALIDATION`). For Recruiting, `partySize` is required, between 2 and `maxPartySizeFor(caps)`. For LFP, `partySize` and `minCp` must be absent (400 `VALIDATION`).

      The post and its poster `PostMember` (snapshot plus `cpAtJoin` = the character's current CP) are created in one transaction, with `worldId` and `guildId` copied from the character. Then `post.created` is emitted. Returns 201 `PostDetailDTO`.
    - `GET /api/posts?type&bossId&bossDifficultyId&guildId&worldIds=1,2&from&to&flexible=1` (public) → `PostSummaryDTO[]`:
      - Only non-deleted posts with `status = open` and `expiresAt > now`, newest `createdAt` first, limit 100.
      - `from`/`to` (ISO) filter `scheduledAt` and exclude flexible posts.
      - `flexible=1` returns only flexible posts.
    - `GET /api/posts/:id` → `PostDetailDTO`:
      - Visible when the effective status is `open` or `full` and the post is not deleted.
      - Otherwise only to the poster, members, and admin; everyone else gets 404 `NOT_FOUND`.
      - `incomingRequests` and `sentInvites` are filled only for the poster. Task 5 fills them; until then they are `[]`.
  - `getVisiblePost(prisma, id, viewer: Viewer | null, now): Promise<PostRow>` (in `service.ts`, reused by later tasks)
  - `loadPostForUpdate(tx, id): Promise<PostRow>` (in `service.ts`). It runs `SELECT id FROM "Post" WHERE id = $1 FOR UPDATE` via `tx.$queryRaw`, then a normal `findUnique` with `postInclude`, and throws 404 if missing.

- [ ] **Step 1: Write the failing tests.**
  - Setup: Kronos, an active guild, Hard Lucid (cap 6) and Normal Limbo (cap 3), and the character `Lily` owned by `u-1`.
  - **Create:**
    - `recruiting create → 201`: the body matches `{ type:'recruiting', world:{name:'Kronos'}, partySize:4, memberCount:1, status:'open', isPoster:true, poster:{ role:'poster', snapshot:{ ign:'Lily' }, cpAtJoin: 1500000000 } }`, and `events` contains `{type:'post.created'}`.
    - `expiresAt = scheduledAt + 3h`; flexible gives `createdAt + 7d`.
    - `partySize 4 with Normal Limbo (cap 3) → 400 VALIDATION`; `partySize 1 → 400`; `lfp with partySize → 400`.
    - `scheduledAt 31 days ahead → 400`; `scheduledAt 1h ago → 400`.
    - `someone else's character → 403 NOT_OWNER`; `visitor → 401`.
    - `duplicate bossDifficultyIds → 400`.
  - **Board:**
    - `board lists open posts newest first`.
    - `filters type, bossId, bossDifficultyId, guildId, worldIds=…, from/to, flexible=1`.
    - **Review focus 2:** a post stored as `status:'open'` with `expiresAt` 1 minute ago is not listed.
    - `full and deleted posts not listed`.
  - **Detail:**
    - `detail of open post visible to visitor with members[]`.
    - `detail of expired post → 404 for stranger, 200 for poster`.
    - `guild in DTO has no webhookUrl` (`JSON.stringify` doesn't contain `webhooks`).
- [ ] **Step 2:** Run `npm test -w server -- posts.create posts.board`. Expected: FAIL.
- [ ] **Step 3:** Implement the snapshot, serializer, service, and routes.
- [ ] **Step 4:** Run `npm test -w server -- posts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): create posts, board listing, post detail`.

---

### Task 4: Post lifecycle — close, delete, renew, admin delete

**Files:**
- Modify: `server/src/posts/service.ts`, `server/src/posts/routes.ts`
- Test: `server/test/posts.lifecycle.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/posts/:id/close` (poster only, else 403 `NOT_OWNER`) → `PostDetailDTO`. Sets `status:'closed'`, `closedReason:'manual'`, and auto-declines pending requests and invites on the post (each emits `request.declined{auto:true}`), then emits `post.closed{reason:'manual'}`. A post that is already closed returns 409 `POST_CLOSED`.
  - `DELETE /api/posts/:id` (poster only) → 204:
    - If the post has only the poster member, hard-delete it.
    - Otherwise set `deletedAt = now`, auto-decline pending requests, and emit `post.closed{reason:'deleted'}`.
  - `POST /api/posts/:id/renew` (poster only) → `PostDetailDTO`:
    - 409 `NOT_FLEXIBLE` if `scheduledAt` is set.
    - 409 `POST_CLOSED` if `status:'closed'` or deleted.
    - Otherwise `expiresAt = now + FLEXIBLE_TTL_MS` (this also revives a flexible post that expired while open).
  - `DELETE /api/admin/posts/:id` (`requireAdmin`) → 204. A hard delete.
  - `GET /api/posts/:id` for the admin returns any post, including deleted ones.

- [ ] **Step 1: Write the failing tests:**
  - `poster closes → status closed, pending request auto-declined, events post.closed + request.declined{auto:true}`.
  - `non-poster close → 403 NOT_OWNER`; `close twice → 409 POST_CLOSED`.
  - `delete with only poster → row gone (prisma.post.count()===0)`.
  - **Review focus 3:** in a post with a poster and one accepted member (`addMember`), the poster DELETE returns 204.
    - The board doesn't list it.
    - The member's GET detail returns 200 with `deleted:true` and two members.
    - A stranger's GET returns 404.
  - `renew flexible extends expiresAt to now+7d; renew scheduled → 409 NOT_FLEXIBLE; renew closed → 409 POST_CLOSED`.
  - `renew an expired flexible post makes it appear on the board again`.
  - `admin hard delete removes even a soft-deleted party post; non-admin → 403`.
- [ ] **Step 2:** Run `npm test -w server -- posts.lifecycle`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w server -- posts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): close, delete, renew posts; admin hard delete`.

---

### Task 5: Join requests — create, accept, decline, cancel

**Files:**
- Create: `server/src/requests/serialize.ts`, `server/src/requests/service.ts`, `server/src/requests/routes.ts`
- Modify: `server/src/app.ts`, `server/src/posts/serialize.ts` (fill `incomingRequests`, `sentInvites`, `myPending`)
- Test: `server/test/requests.join.test.ts`

**Interfaces:**
- Consumes: `loadPostForUpdate`, `getVisiblePost`, `memberSnapshot`, `effectivePostStatus`, `DomainEvents`.
- Produces:
  - `requestInclude`: character → `characterInclude`.
  - `toRequestDTO(row, viewerUserId, storage): RequestDTO`.
  - `POST /api/posts/:id/requests` `{ characterId }` (requires user) → 201 `RequestDTO`. The checks, in order:
    1. The post is visible and of type `recruiting`, else 409 `WRONG_POST_TYPE`.
    2. The effective status is `open`, else 409 `POST_CLOSED` or `POST_FULL`.
    3. The viewer owns the character, else 403 `NOT_OWNER`.
    4. `character.worldId === post.worldId`, else 400 `WRONG_WORLD`.
    5. The character is not already a member, else 409 `ALREADY_MEMBER`. This also covers the poster's own character.
    6. No pending request exists for (post, character), else 409 `ALREADY_PENDING`. Map P2002 on `Request_one_pending` to this code as well.
    7. Create the request with `kind:'join_request'` and emit `request.created`.
  - `POST /api/requests/:id/accept` → `PostDetailDTO`:
    - Who decides: for `join_request`, the post's poster; for `invite`, the owner of `request.character`. Anyone else gets 403 `NOT_ALLOWED`.
    - Inside one `$transaction`: `loadPostForUpdate` (row lock), then:
      1. The request must be pending, else 409 `NOT_PENDING`.
      2. The post must not be deleted and its effective status must be `open`, else 409 `POST_CLOSED` or `POST_FULL`.
      3. The character must still exist on the same world, else 400 `WRONG_WORLD`.
      4. The character must not already be a member, else 409 `ALREADY_MEMBER`. In that case mark the request declined.
    - Then insert a `PostMember` (role `member`, `cpAtJoin` = current CP, snapshot) and set the request to `accepted` with `decidedAt`.
    - If the member count now equals `partySize`: set the post to `status:'full'`, `closedReason:'full'`, and auto-decline every other pending request on the post.
    - After commit, emit `request.accepted`, plus `request.declined{auto:true}` for each auto-decline.
  - `POST /api/requests/:id/decline` (same decider rule) → `RequestDTO` with status `declined`. Emits `request.declined{auto:false}`.
  - `POST /api/requests/:id/cancel` → `RequestDTO` with status `cancelled`. Emits `request.cancelled`. Who may cancel: for `join_request`, the applicant (owner of the character); for `invite`, the post's poster. Anyone else gets 403 `NOT_ALLOWED`. A request that isn't pending gets 409 `NOT_PENDING`.
  - The serializer fills `PostDetailDTO.incomingRequests` (poster only: pending join requests), `sentInvites` (poster only: pending invites), and `myPending` (pending requests on this post whose character the viewer owns).

- [ ] **Step 1: Write the failing tests.** Setup: a Recruiting post by `u-1` with `partySize:3`, plus `u-2` with `Bob` on Kronos and `Zed` on Bera.
  - `u-2 requests with Bob → 201 pending; event request.created; poster detail incomingRequests has Bob with his bosses`.
  - **Review focus 5:**
    - `Zed → 400 WRONG_WORLD`.
    - `u-2 using u-1's character → 403 NOT_OWNER`.
    - `poster's own character → 409 ALREADY_MEMBER`.
    - `second request with Bob → 409 ALREADY_PENDING`.
  - `request on an lfp post → 409 WRONG_POST_TYPE`.
  - **Review focus 2:** for an expired-but-stored-open post, the request returns 409 `POST_CLOSED`. Accepting an already-pending request after expiry also returns 409 `POST_CLOSED`.
  - `poster accepts → members has Bob with cpAtJoin; request accepted`.
  - `non-poster accept → 403 NOT_ALLOWED`.
  - `accept filling the party → status full, other pending request auto-declined, events include request.declined{auto:true}`. Then `full post → new request 409 POST_FULL`.
  - **Review focus 1:**
    - Setup: `partySize:2` (one slot left) and two pending requests from different users.
    - Run both accepts with `Promise.all`.
    - Expect exactly one 200 and one 409 (`POST_FULL`, or `NOT_PENDING` if the loser had been auto-declined first; assert the code is one of those two).
    - The member count must equal 2.
  - `decline → declined; can re-request afterwards (201)`.
  - `applicant cancels → cancelled; poster cancel of a join_request → 403 NOT_ALLOWED; cancel twice → 409 NOT_PENDING`.
  - `myPending shows u-2's pending request on detail for u-2 only`.
- [ ] **Step 2:** Run `npm test -w server -- requests.join`. Expected: FAIL.
- [ ] **Step 3:** Implement the request serializer, service, and routes.
- [ ] **Step 4:** Run `npm test -w server`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(server): join requests with race-safe accept`.

---

### Task 6: Invites from LFP posts

**Files:**
- Modify: `server/src/requests/service.ts`, `server/src/requests/routes.ts`
- Test: `server/test/requests.invite.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/posts/:lfpPostId/invites` `{ recruitingPostId }` (requires user) → 201 `RequestDTO`. The checks, in order:
    1. The LFP post is visible, of type `lfp`, and effectively `open`, else 409 `WRONG_POST_TYPE` or `POST_CLOSED`.
    2. The recruiting post belongs to the viewer (403 `NOT_OWNER`), is of type `recruiting`, and is effectively `open` (409 `POST_CLOSED` or `POST_FULL`).
    3. Both posts are on the same world, else 400 `WRONG_WORLD`.
    4. The LFP poster's character still exists (409 `POST_CLOSED` if not) and is not already a member of the recruiting post (409 `ALREADY_MEMBER`).
    5. No pending request exists for (recruitingPost, character), else 409 `ALREADY_PENDING`.
    6. Create the request with `kind:'invite'`, `postId = recruitingPostId`, `characterId = lfp.posterCharacterId`, `lfpPostId`, and emit `request.created`.
  - Accepting an invite reuses Task 5's accept. In the same transaction it also:
    - Sets the LFP post to `status:'closed'`, `closedReason:'lfp_matched'` (if not already closed or deleted).
    - Auto-declines that LFP post's other pending invites (`lfpPostId` = it).
    - After commit, emits `post.closed{reason:'lfp_matched'}` plus the auto-decline events.
  - Declining is done by the invitee and cancelling by the inviter (the recruiting poster), per Task 5's rules.

- [ ] **Step 1: Write the failing tests.** Setup: `u-2` has an LFP post with `Bob`. `u-1` has Recruiting post A and `u-3` has Recruiting post B, both on Kronos.
  - `u-1 invites from A → 201 kind invite; u-1 detail(A).sentInvites has Bob`.
  - `u-2 (invitee) accepts → Bob in A's lineup; LFP post closed lfp_matched; B's pending invite to Bob auto-declined; board no longer lists the LFP post`.
  - `u-1 cannot accept own invite → 403 NOT_ALLOWED`.
  - `invite using someone else's recruiting post → 403 NOT_OWNER`.
  - `inviting onto a Bera recruiting post → 400 WRONG_WORLD`.
  - `invite to a recruiting post (wrong type target) → 409 WRONG_POST_TYPE`.
  - `duplicate invite → 409 ALREADY_PENDING`.
  - `inviter cancels → cancelled; invitee decline → declined`.
- [ ] **Step 2:** Run `npm test -w server -- requests.invite`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w server`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(server): invites from LFP posts`.

---

### Task 7: Members leave and remove, "My" endpoints, and character deletion

**Files:**
- Modify: `server/src/posts/service.ts`, `server/src/posts/routes.ts`, `server/src/requests/routes.ts`, `server/src/characters/service.ts` + `routes.ts` (DELETE)
- Test: `server/test/posts.members.test.ts`, `server/test/posts.mine.test.ts`

**Interfaces:**
- Produces:
  - `DELETE /api/posts/:id/members/:memberId` → `PostDetailDTO`:
    - The owner of the member's character leaves (`removedBy:'self'`), or the poster removes the member (`removedBy:'poster'`). Anyone else gets 403 `NOT_ALLOWED`.
    - The poster's own member row gives 409 `CANNOT_LEAVE_OWN_POST`.
    - A deleted post gives 409 `POST_CLOSED`.
    - The `PostMember` row is deleted. If the post was `full` and is not expired or deleted, it goes back to `status:'open'` (`closedReason: null`) and emits `post.reopened`. Emits `member.left`.
  - `GET /api/me/parties` (requires user) → `PostDetailDTO[]`:
    - Posts where the viewer has a `PostMember` row (any role) **and** the post has ≥ 2 members, deleted ones included.
    - Ordered by `scheduledAt` descending, with nulls ordered by `createdAt`, limit 100.
  - `GET /api/me/posts` (requires user) → `PostSummaryDTO[]`: the viewer's non-deleted posts in any effective status, newest first.
  - `GET /api/me/requests` (requires user) → `MyRequestsDTO`:
    - `incomingInvites`: pending invites to the viewer's characters.
    - `outgoingRequests`: the viewer's pending join requests.
    - Each item includes its post summary.
  - Character delete (`DELETE /api/characters/:id`, in Plan 1's service) now runs in one transaction:
    1. Close the character's open and full posts that aren't deleted (`closedReason:'character_deleted'`).
    2. Auto-decline those posts' pending requests and invites.
    3. Delete the character. The FKs then null out `PostMember.characterId` and `Post.posterCharacterId`, and cascade-delete the character's own requests.
    4. After commit, emit the matching `post.closed` and `request.declined{auto:true}` events.
  - Party DTOs for a member whose character was deleted have `character: null` and `characterId: null`, with the snapshot intact. The poster's `isPoster` still works through `posterUserId`.

- [ ] **Step 1: Write the failing tests:**
  - `member leaves → removed; event member.left{removedBy:'self'}`.
  - `poster removes member → removedBy 'poster'`.
  - `stranger remove → 403 NOT_ALLOWED`; `poster leaving own row → 409 CANNOT_LEAVE_OWN_POST`.
  - `leaving a full post reopens it (status open, on board, event post.reopened)`.
  - `leaving an expired full post does not reopen`.
  - `me/parties includes a soft-deleted post with 2 members and excludes a solo post`.
  - `me/posts lists my closed post but not my deleted one`.
  - `me/requests: incoming invite + outgoing join request`.
  - **Review focus 4:** `Bob` is a member of `u-1`'s party and also has an open LFP post with a pending invite to it. `u-2` deletes Bob, which returns 204.
    - `u-1`'s `me/parties` lineup has a member with `character:null` and `snapshot.ign:'Bob'`, and `cpAtJoin` is preserved.
    - Bob's LFP post is closed with reason `character_deleted`.
    - `prisma.request.count({ where: { characterId: bobId } }) === 0`.
    - The events include `post.closed{reason:'character_deleted'}`.
- [ ] **Step 2:** Run `npm test -w server -- posts.members posts.mine`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` (root). Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(server): leave/remove members, my parties/posts/requests, character delete keeps party records`.

---

### Task 8: Edit posts (poster only)

**Files:**
- Modify: `server/src/posts/service.ts`, `server/src/posts/routes.ts`, `server/src/events.ts`
- Test: `server/test/posts.edit.test.ts`

**Interfaces:**
- Consumes: `loadPostForUpdate`, `memberSnapshot`, `maxPartySizeFor`, `postExpiresAt`, `effectivePostStatus`, the create-body zod pieces from Task 3 (reuse them, don't duplicate), and the auto-decline helper from Tasks 4/5.
- Produces:
  - `PATCH /api/posts/:id` (poster only, else 403 `NOT_OWNER`) → `PostDetailDTO`.
    - **Body:** any subset of `{ type, characterId, bossDifficultyIds, scheduledAt, partySize, minCp, note }`, validated as on create. `minCp: null` clears it.
    - **Runs** in one transaction under `loadPostForUpdate`.
    - **Closed or deleted posts:**
      - A post that is deleted or `status:'closed'` gives 409 `POST_CLOSED`.
      - A post that is only past `expiresAt` (stored status open or full) may be edited, so the poster can move it to a new time. Every edit recomputes `expiresAt` from the resulting `scheduledAt`.
    - **Rules:**
      1. **Time:** `expiresAt` is recomputed from the resulting `scheduledAt` via `postExpiresAt(scheduledAt, now)`. Switching to flexible therefore gives `now + 7d`, and scheduled gives `scheduledAt + 3h`. The time window is validated as on create.
      2. **Bosses:** `bossDifficultyIds` replaces the post's boss set. The resulting `partySize` must still be ≤ `maxPartySizeFor(caps)`, else 400 `VALIDATION`.
      3. **Party size** (Recruiting only) must be ≥ the current member count, else 409 `PARTY_TOO_SMALL`.
         - If it equals the member count, the post becomes `full` (`closedReason:'full'`) and pending requests and invites are auto-declined.
         - If the post was `full` and the new size is larger, it reopens (`post.reopened`).
      4. **Type and character** may only change while the post has no members besides the poster, else 409 `HAS_MEMBERS`.
         - Changing `type` auto-declines all pending requests and invites tied to the post (both `postId` and `lfpPostId`).
         - Switching to LFP clears `partySize` and `minCp`. Switching to Recruiting requires `partySize`.
      5. **New character:** `characterId` must be the poster's own character (403 `NOT_OWNER`), with an active guild and world.
         - The post's `worldId` and `guildId` are re-copied from the new character.
         - The poster's `PostMember` row gets its `characterId`, `cpAtJoin` and snapshot updated.
         - If the world changed, pending requests and invites are auto-declined.
      6. **LFP posts** reject `partySize` and `minCp`, giving 400 `VALIDATION`.
    - **After commit:** emits `post.updated`, plus any `request.declined{auto:true}` and `post.reopened` events.

- [ ] **Step 1: Write the failing tests:**
  - `poster edits note, scheduledAt, bosses → 200; expiresAt recomputed; event post.updated`.
  - `non-poster PATCH → 403 NOT_OWNER`; `visitor → 401`.
  - `scheduled → flexible sets expiresAt = now + 7d; flexible → scheduled sets scheduledAt + 3h`.
  - `bosses change to Normal Limbo (cap 3) while partySize 4 → 400 VALIDATION`.
  - `partySize below member count → 409 PARTY_TOO_SMALL`.
  - `partySize equal to member count → full + pending request auto-declined`.
  - `raising partySize on a full post reopens it (on board, event post.reopened)`.
  - `type change with no members auto-declines pending invites; → lfp clears partySize/minCp`.
  - `type or character change with a member → 409 HAS_MEMBERS`.
  - `character change to another world (no members) → worldId updated, poster snapshot updated, pending requests auto-declined`.
  - `edit a manually closed post → 409 POST_CLOSED; edit an expired-but-open post with a new future scheduledAt → 200 and it is back on the board`.
  - `minCp null clears it`.
- [ ] **Step 2:** Run `npm test -w server -- posts.edit`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w server`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(server): poster can edit posts`.

---

### Task 9: Web — post hooks, routes and nav, PostCard, board

**Files:**
- Create: `web/src/api/postHooks.ts`, `web/src/components/post/PostCard.tsx`, `web/src/components/post/post.css`, `web/src/components/post/time.ts`, `web/src/pages/BoardPage.tsx`
- Modify: `web/src/App.tsx`, `web/src/components/Layout.tsx`, `web/src/api/errors.ts`, `web/test/layout.test.tsx` (nav changes)
- Test: `web/test/board.test.tsx`, `web/test/postTime.test.ts`

**Interfaces:**
- Consumes: the Task 2 DTOs, `api`/`ApiError`, `CharacterCard`, `useMe`, `useCharacters({mine:true})`, `useBosses`, `useGuilds`, `useWorlds`, `useRarityTiers`.
- Produces:
  - **Routes:**
    - `/` → `BoardPage` (new home)
    - `/characters` → `CharactersPage` (moved from `/`)
    - `/posts/new` → `NewPostPage`
    - `/posts/:id` → `PostDetailPage`
    - `/posts/:id/edit` → `NewPostPage` (edit mode)
    - `/me/parties` → `MyPartiesPage`
    - Pages that later tasks build get a placeholder file now.
  - **Nav order:** "Board" (`/`), "Characters", then for logged-in users "My parties" and "My characters", then "Admin" for the admin.
  - **Query keys:** every post-related key starts with `'posts'`. Mutations invalidate `['posts']` (which also covers `['posts','mine',…]`).
  - **Hooks:**
    - `usePosts(filters: PostFilters)` and `usePost(id)`
    - `useCreatePost()`, `useUpdatePost(id)`, `useClosePost(id)`, `useDeletePost(id)`, `useRenewPost(id)`
    - `useRequestJoin(postId)`, `useInvite(lfpPostId)`
    - `useAcceptRequest()`, `useDeclineRequest()`, `useCancelRequest()`
    - `useRemoveMember(postId)`
    - `useMyParties()`, `useMyPosts()`, `useMyRequests()` (enabled only when logged in)
    - `PostFilters = { type?: PostType; bossId?: number; bossDifficultyId?: number; guildId?: string; worldIds?: number[]; when?: 'any'|'24h'|'7d'|'flexible' }`. `when` maps to `from = now`, `to = now + 24h or 7d`, or `flexible=1`.
  - `time.ts`:
    - `formatWhen(scheduledAt: string | null, now?: Date): string`: "Flexible", or a local weekday, date and time like "Tue, Nov 10, 8:00 PM" via `Intl.DateTimeFormat` (default locale), plus " (in 3h)" when within 24h.
    - `localInputToUtcIso(value: string /* datetime-local */): string`
    - `overlaps(a: string | null, b: string | null): boolean`: true when both are set and `|a − b| < OVERLAP_WINDOW_MS`.
  - `<PostCard post={PostSummaryDTO} tiers onOpen />`:
    - A type badge (`POST_TYPE_LABELS`), a compact poster `CharacterCard` (snapshot fallback when `character` is null), boss chips "Hard Lucid", `formatWhen`, world and guild.
    - For Recruiting posts: "2/4" slots and "Min CP 300M" (via `formatCp`).
    - The note, clamped to 2 lines.
    - The whole card links to `/posts/:id`.
  - `BoardPage`:
    - **Filters:** type (All/LFP/Recruiting), boss, difficulty (populated from the chosen boss), guild, world multi-select, and When (Any / Next 24h / This week / Flexible).
    - **World default:** the distinct worlds of `useCharacters({mine:true})` when logged in and the user has characters; otherwise all.
    - A "New post" button for logged-in users.
    - **Layout:** a responsive grid, one column on phones.
    - An empty state: "No open posts match. Be the first to post!"
  - `friendlyError` gains friendly text for every Global-Constraints post code.

- [ ] **Step 1: Write the failing tests:**
  - **postTime tests:**
    - `formatWhen(null) === 'Flexible'`.
    - `localInputToUtcIso('2026-11-10T20:00')` equals `new Date(2026,10,10,20,0).toISOString()`.
    - `overlaps` is true at 2h59m apart and false at 3h. A null on either side is false.
  - **Board tests (mockApi):**
    - `renders posts from /api/posts as cards with type badge, bosses, slots 2/4`.
    - `logged-in user with Kronos character → initial request has worldIds=<kronosId>`.
    - `choosing type Recruiting refetches with type=recruiting`.
    - `When=Flexible sends flexible=1`.
    - `empty state text`.
    - `card links to /posts/:id`.
  - **Layout test update:**
    - `Board link to "/" and Characters link to "/characters"`.
    - `My parties shown when logged in`.
- [ ] **Step 2:** Run `npm test -w web -- board postTime layout`. Expected: FAIL.
- [ ] **Step 3:** Implement. Move the existing character-browse tests' route to `/characters` if they depend on `/`.
- [ ] **Step 4:** Run `npm test -w web`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(web): post hooks, board page, nav restructure`.

---

### Task 10: Web — new and edit post form

**Files:**
- Create: `web/src/pages/NewPostPage.tsx`, `web/src/components/post/BossMultiPicker.tsx`
- Test: `web/test/newPost.test.tsx`

**Interfaces:**
- Consumes: `useCreatePost`, `useUpdatePost`, `usePost`, `useCharacters({mine:true})`, `useBosses`, `localInputToUtcIso`, `maxPartySizeFor`, `MAX_POST_BOSSES`.
- Produces:
  - `<BossMultiPicker value={number[]} onChange bosses={BossDTO[]} max={10} />`: a list grouped by boss with difficulty checkboxes and a selected count.
  - `NewPostPage`:
    - Requires login, otherwise shows the login prompt. A user with no characters sees "Add a character first" linking to `/me/characters/new`.
    - **Fields:**
      - Type segmented toggle (Recruiting / Looking for party)
      - Character select (mine; shows world)
      - Bosses (`BossMultiPicker`)
      - When: a `datetime-local` input plus a "Flexible" checkbox that disables it
      - Party size: Recruiting only; options 2..`maxPartySizeFor(selected caps)`; default min(4, max)
      - Min CP: Recruiting only; optional; commas allowed
      - Note: 300-character counter
    - **Client validation:**
      - At least one boss.
      - The time is required unless Flexible, and must be in the future.
      - A party size above the allowed max is clamped when bosses change.
    - **Submit:** POSTs `{ type, characterId, bossDifficultyIds, scheduledAt: flexible ? null : localInputToUtcIso(v), partySize?, minCp?, note }`, then navigates to `/posts/:id`.
    - Server errors are shown through `friendlyError`.
  - Board posts default to the character's world (no world field; the server copies it).
  - **Edit mode** (`/posts/:id/edit`):
    - Only the poster may use it; anyone else sees "Only the poster can edit this post."
    - The form is prefilled from `usePost(id)`, including the `scheduledAt` converted to local `datetime-local`.
    - Type and character are disabled (with the hint "Can't change while others are in the party") when `memberCount > 1`.
    - Party size options start at `max(2, memberCount)`.
    - Saving sends a PATCH with only the changed fields, then navigates to `/posts/:id`.

- [ ] **Step 1: Write the failing tests:**
  - `recruiting submit`:
    - Pick Lily, tick Hard Lucid, enter `2026-11-10T20:00`, party size 4, min CP `300,000,000`, then Save.
    - The POST body equals `{ type:'recruiting', characterId, bossDifficultyIds:[lucidHardId], scheduledAt: localInputToUtcIso('2026-11-10T20:00'), partySize:4, minCp:300000000, note:'' }`.
    - The page navigates to `/posts/p1`. Use fake timers set to 2026-11-09.
  - `LFP hides party size and min CP and omits them from the body`.
  - `flexible sends scheduledAt null`.
  - `selecting Normal Limbo (cap 3) limits party size options to 2..3 and clamps 4→3`.
  - `no bosses → error, no POST`.
  - `user with no characters sees Add a character first`.
  - `edit mode prefills from the post and PATCHes only changed fields (note + partySize)`.
  - `edit mode with 2 members disables type and character and offers party sizes starting at 2`.
  - `non-poster on /posts/:id/edit sees the poster-only message`.
- [ ] **Step 2:** Run `npm test -w web -- newPost`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w web -- newPost`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): new and edit post form`.

---

### Task 11: Web — post detail with lineup and poster controls

**Files:**
- Create: `web/src/pages/PostDetailPage.tsx`, `web/src/components/post/LineupView.tsx`
- Test: `web/test/postDetail.test.tsx`

**Interfaces:**
- Consumes: `usePost`, `useClosePost`, `useDeletePost`, `useRenewPost`, `useAcceptRequest`, `useDeclineRequest`, `useCancelRequest`, `useRemoveMember`, `CharacterCard` (`bossContext`), `CardDetailModal`, `formatWhen`, `formatCp`.
- Produces:
  - `<LineupView post={PostDetailDTO} tiers onRemove?(memberId) onLeave?(memberId) />`:
    - **Cards:** one per member. Each uses `character` when present; when the character is deleted, it renders a "Deleted character" snapshot card with the IGN, class, and level from the snapshot.
    - **Boss badges:** each card gets `bossContext` = the post's bosses (label "Hard Lucid").
    - **CP:** a caption "CP at join 1.5B", plus "now 1.6B" when the current CP differs.
    - **Recruiting posts:** empty slot placeholders up to `partySize` (e.g. "Open slot").
    - **Controls:** a "Remove" button on non-poster members for the poster, and a "Leave" button on the viewer's own member row (`isMine`).
    - Clicking a card with a character opens `CardDetailModal`.
  - `PostDetailPage`:
    - **Header:** type badge, bosses, `formatWhen`, world, guild, status pill (Open / Full / Closed / Deleted), slots, min CP, note. A "This party has ended" banner shows when the status is closed.
    - **Poster-only:**
      - An "Applicants" section with pending join-request cards, each with `bossContext`, a "Below min CP" badge when CP < `minCp`, and Accept / Decline buttons.
      - An "Invites sent" section with a Cancel button.
      - Edit (links to `/posts/:id/edit`, hidden when closed or deleted), Close, Delete (`window.confirm`), and Renew (flexible only) actions.
    - Server errors are shown inline via `friendlyError`.
    - 404 shows "This post isn't available."
    - Task 11 adds the request and invite actions for non-posters.

- [ ] **Step 1: Write the failing tests:**
  - `lineup renders poster + member cards with boss badges and "CP at join" captions; recruiting partySize 4 with 2 members shows 2 Open slot placeholders`.
  - `deleted character member renders snapshot card with its IGN`.
  - `poster sees applicants; Accept posts to /api/requests/r1/accept; Decline to /decline`.
  - `below-min-CP badge shown for applicant with CP 100M on minCp 300M post`.
  - `poster Delete confirms then DELETEs and navigates to /`.
  - `Renew shown only for flexible posts`.
  - `Edit link shown to poster only, hidden on closed posts`.
  - `non-poster sees no applicants section`.
  - `404 shows unavailable message`.
  - `closed post shows ended banner and no poster actions except Delete`.
- [ ] **Step 2:** Run `npm test -w web -- postDetail`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w web -- postDetail`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): post detail with lineup and poster controls`.

---

### Task 12: Web — request to join, invite, leave

**Files:**
- Create: `web/src/components/post/CharacterPicker.tsx`
- Modify: `web/src/pages/PostDetailPage.tsx`
- Test: `web/test/postActions.test.tsx`

**Interfaces:**
- Consumes: `useRequestJoin`, `useInvite`, `useCancelRequest`, `useRemoveMember`, `useCharacters({mine:true})`, `useMyPosts`, `useMyParties`, `overlaps`.
- Produces:
  - `<CharacterPicker characters={CharacterDTO[]} worldId post={PostDetailDTO} myParties={PostDetailDTO[]} onPick(characterId) />`:
    - It lists only characters on the post's world.
    - It disables characters that are already members or have a pending request (from `post.myPending`).
    - Per character it shows a warning when CP < `post.minCp` ("Below the minimum CP — you can still apply") and when `overlaps(post.scheduledAt, party.scheduledAt)` for any open or full party in `myParties` that contains that character ("Already in a party around this time").
    - When nothing is eligible it says "None of your characters are on <World>."
  - On `PostDetailPage`, for logged-in non-posters:
    - **Recruiting posts with effective status `open`:** a "Request to join" button opens the picker. After a request, the viewer's pending requests show with Cancel.
    - **LFP posts with effective status `open`:** an "Invite" button opens a list of the viewer's open Recruiting posts on the same world (from `useMyPosts`), showing an empty state if there are none, and sends `POST /api/posts/:lfpId/invites`.
    - **Members:** a Leave button (via `LineupView` `onLeave`) with a confirm.
    - **Visitors:** "Log in with Discord to join."

- [ ] **Step 1: Write the failing tests:**
  - `Request to join lists only same-world characters and posts {characterId}`.
  - `pending request shows Cancel which posts /api/requests/:id/cancel`.
  - `below-min-CP warning text for a 100M character on a 300M post`.
  - `overlap warning when my character is in a party 2h apart`.
  - `no same-world characters → "None of your characters are on Kronos."`.
  - `LFP post Invite lists my open recruiting posts on same world and posts {recruitingPostId}`.
  - `member Leave confirms and DELETEs /api/posts/:id/members/:memberId`.
  - `visitor sees log in prompt`.
  - `ALREADY_PENDING error shows friendly text`.
- [ ] **Step 2:** Run `npm test -w web -- postActions`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w web`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(web): request to join, invite, leave`.

---

### Task 13: Web — "My parties" page

**Files:**
- Create: `web/src/pages/MyPartiesPage.tsx`
- Test: `web/test/myParties.test.tsx`

**Interfaces:**
- Consumes: `useMyParties`, `useMyPosts`, `useMyRequests`, `useAcceptRequest`, `useDeclineRequest`, `useCancelRequest`, `LineupView`, `PostCard`, `formatWhen`.
- Produces:
  - `MyPartiesPage` requires login and has three tabs (the tab is kept in the `?tab=` query):
    - **Parties** (default): upcoming first (effective status open or full), then "Past". Each item shows bosses, `formatWhen`, the status pill (Deleted/Closed included), and a read-only `LineupView` (no Remove/Leave controls), and links to `/posts/:id`.
    - **My posts:** `PostCard`s of the viewer's posts with their status pills.
    - **Requests & invites:**
      - Incoming invites, each showing which of my characters it's for, the post summary, and Accept / Decline.
      - My outgoing requests, each showing the post summary and Cancel.
      - Each section has an empty state.
  - Accepting an invite navigates to that post.

- [ ] **Step 1: Write the failing tests:**
  - `parties tab splits upcoming and past and renders lineup cards, including a deleted post with its lineup`.
  - `?tab=posts shows my posts`.
  - `requests tab: Accept on an invite posts /api/requests/:id/accept and navigates to /posts/:postId`.
  - `Cancel outgoing request`.
  - `empty states`.
  - `logged out shows login prompt`.
- [ ] **Step 2:** Run `npm test -w web -- myParties`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` (root). Expected: all PASS. Also run `npm run build -w web`. Expected: success.
- [ ] **Step 5:** Commit: `feat(web): My parties page`.

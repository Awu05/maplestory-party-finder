# Party Finder — Plan 3: Notifications, Discord, Daily Sync, Moderation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every party event reaches the right people. Players get an in-app notification bell. New posts are broadcast to each connected guild's Discord channel, and requests, invites, and accepts ping the right person in their guild's channel. Characters refresh from Nexon daily. The admin can test webhooks, see delivery failures, and moderate users, characters, and posts.

**Architecture:**
- **Events in:** Plan 2's `DomainEvents` sink is replaced by an `EventDispatcher`. It resolves recipients, writes `Notification` rows, and enqueues `WebhookDelivery` rows (an outbox) for Discord.
- **Delivery:** a `WebhookWorker` drains the outbox in the background with retries and backoff. The user's action never waits on Discord.
- **Daily sync:** a `DailySyncJob` re-syncs characters from Nexon, throttled. A `JobRun` row prevents re-running after restarts.
- **Testing seams:** the worker and job expose `runOnce()` for tests, and `index.ts` starts and stops their timers. Discord HTTP sits behind a `WebhookSender` interface, faked in tests.
- **Message building:** Discord message bodies are built by pure functions, with mentions locked down via `allowed_mentions`.

**Tech Stack:** Same as Plans 1–2.

**Spec:** `docs/superpowers/specs/2026-11-09-party-finder-design.md` (§7, §9, §5.4, §14). Earlier plans: `…-1-foundation.md`, `…-2-posts-parties.md`. Plan 1 follow-ups: `…-1-followups.md`.

**Depends on Plan 2 being merged:**
- the `DomainEvent` union (including `post.updated`)
- `Post`, `PostMember`, and `Request` models
- `postInclude` and `toPostSummaryDTO`
- the auto-decline helper
- `deleteCharacter` closing posts

## Global Constraints

- **The user's action never waits on Discord or Nexon.** Notifications are written after commit, and dispatcher errors are logged and swallowed. Discord sends happen only in the worker.
- **Which guilds hear about a new post:** every guild that is `active`, has a `webhookUrl`, and plays the post's world (`GuildWorld`). Nothing is sent for drafts, edits, closes, or declines (§7.2).
- **Pings** go to the recipient's own guild channel (the guild of the recipient's character), @mentioning their Discord user ID:
  - **Join request:** pings the poster.
  - **Invite:** pings the invitee.
  - **Accepted join request:** pings the applicant.
  - **Accepted invite:** no ping. The invitee accepted it themselves; the poster gets an in-app notification only.
- **Mention safety:**
  - Every Discord payload sets `allowed_mentions`. Broadcasts use `{ parse: [] }`, and pings use `{ parse: [], users: [<recipientDiscordId>] }`.
  - User text (note, IGN) is placed in embed fields. `@everyone` and `@here` in user text are neutralized with a zero-width space after the `@`.
- **Discord timestamps:** `<t:UNIX:F>` plus `<t:UNIX:R>`, or "Flexible" when there is no time.
- **Links:** `${config.webOrigin}/posts/:id`.
- **Worker retries:**
  - Delays `[30s, 2m, 10m, 1h]`, max 5 attempts, then `failed`.
  - HTTP 429 waits for `retry_after`, without counting an attempt beyond the max.
  - HTTP 404 or 401 (webhook deleted) means `failed` immediately.
  - Delivery is at-least-once, and a delivery marked `sent` is never resent.
- **Webhook URLs never appear** in logs, `lastError`, or any API response except the admin guild endpoints from Plan 1.
- **In-app notification recipients:**

| Event | Who is notified |
|---|---|
| Join request | the poster |
| Invite | the invitee |
| Join request accepted | the applicant |
| Invite accepted | the poster |
| Manual decline | the other side |
| Auto-decline (post filled, closed, or changed) | the applicant or invitee: "The party filled or the post closed" |
| Member removed by the poster | the removed member |
| Member left | the poster |

  Cancellations, post edits, and closes notify no one.
- **Daily Nexon sync:**
  - Runs at most once per 24h (tracked in `JobRun`), processing characters oldest `lastSyncedAt` first.
  - One Nexon call every 2 s, bypassing the 10-minute lookup cache.
  - Characters of banned users are skipped. It never throws out of the loop.
- **Banned users:**
  - They can't act (Plan 1's 403 `BANNED`). Their characters are hidden from public character lists.
  - Their open posts close (`closedReason:'banned'`) and their pending requests and invites are auto-declined at ban time.
  - Logging in redirects them to `/?login=banned`.
- **Admin-only actions:**
  - User ban and unban (the admin can't ban themselves; admins come from `ADMIN_DISCORD_IDS`)
  - character reassign and delete
  - post list and delete
  - webhook test and health
- **Layout:** must work at phone width.

## Review Focus

1. **A post note containing `@everyone`, or a `<@123>` typed in the note.** The Discord message never mass-pings: `allowed_mentions.parse` is `[]` and the text is neutralized. (Test in Task 2.)
2. **Discord down or rate-limited.** Creating a post still returns 201. The delivery retries on the backoff schedule, and running the worker again after a success never resends. (Test in Task 3.)
3. **Webhook deleted on Discord's side (404).** The delivery is marked `failed` right away and shows in admin health, and the webhook URL appears nowhere in `lastError` or the response. (Test in Task 3 and Task 6.)
4. **A guild that is inactive, has no webhook, or doesn't play the post's world.** No delivery row is created for it. (Test in Task 4.)
5. **A banned user.**
   - Their characters disappear from browse.
   - Their open posts close and their pending requests decline.
   - Their login lands on `/?login=banned`.
   - The daily sync skips them.

   (Tests in Task 7 and Task 8.)

---

## File Structure

```
server/prisma/schema.prisma                # + Notification, WebhookDelivery, JobRun; PostClosed 'banned'
server/src/discord/messages.ts             # pure payload builders + sanitize
server/src/discord/sender.ts               # WebhookSender interface + HttpWebhookSender
server/src/discord/outbox.ts               # enqueueDelivery, WebhookWorker
server/src/notifications/dispatcher.ts     # EventDispatcher implements DomainEvents
server/src/notifications/routes.ts         # GET/POST notifications
server/src/jobs/dailySync.ts               # DailySyncJob
server/src/admin/webhooks.ts               # test message + health routes
server/src/admin/moderation.ts             # users, characters, posts moderation
server/src/nexon/client.ts                 # (modify) findByName(ign, { fresh })
server/src/characters/service.ts           # (modify) sync uses fresh fetch; list hides banned owners
server/src/auth/routes.ts                  # (modify) banned → /?login=banned
server/src/index.ts                        # (modify) wire dispatcher, worker, job; stop on shutdown
shared/src/types.ts                        # + NotificationDTO, WebhookHealthDTO, AdminUserDTO, AdminPostDTO
web/src/api/notifyHooks.ts, web/src/api/hooks.ts (admin additions)
web/src/components/NotificationBell.tsx + bell.css
web/src/pages/admin/WebhooksAdmin.tsx, UsersAdmin.tsx, PostsAdmin.tsx
web/src/components/Layout.tsx              # (modify) bell + banned banner
```

---

### Task 1: Schema and shared DTOs

**Files:**
- Modify: `server/prisma/schema.prisma`, `shared/src/types.ts` (`'banned'` is already in Plan 2's `PostClosedReason`)
- Create: migration `<ts>_notifications_outbox`
- Test: `server/test/notify.schema.test.ts`

**Interfaces:**
- Produces (Prisma):

```prisma
enum DeliveryStatus { pending sent failed }
model Notification {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind      String    // join_request | invite | accepted | declined | auto_declined | removed | member_left
  text      String
  link      String    // app-relative path, e.g. /posts/abc
  createdAt DateTime  @default(now())
  readAt    DateTime?
  @@index([userId, readAt, createdAt])
}
model WebhookDelivery {
  id            String         @id @default(cuid())
  guildId       String
  guild         Guild          @relation(fields: [guildId], references: [id], onDelete: Cascade)
  eventType     String         // post.created | request.created | request.accepted | test
  payload       Json           // full Discord execute-webhook body
  status        DeliveryStatus @default(pending)
  attempts      Int            @default(0)
  nextAttemptAt DateTime       @default(now())
  lastError     String?
  createdAt     DateTime       @default(now())
  sentAt        DateTime?
  @@index([status, nextAttemptAt])
  @@index([guildId, createdAt])
}
model JobRun { name String @id; lastRunAt DateTime; lastResult Json? }
```

- Produces (shared):

```ts
export interface NotificationDTO { id: string; kind: string; text: string; link: string; createdAt: string; read: boolean }
export interface NotificationListDTO { items: NotificationDTO[]; unreadCount: number }
export interface WebhookFailureDTO { id: string; eventType: string; attempts: number; lastError: string | null; createdAt: string }
export interface WebhookHealthDTO {
  guildId: string; guildName: string; hasWebhook: boolean; active: boolean;
  lastSentAt: string | null; pending: number; failedLast24h: number; recentFailures: WebhookFailureDTO[] /* ≤ 10 */;
}
export interface AdminUserDTO { id: string; discordUsername: string; avatarUrl: string | null; banned: boolean; isAdmin: boolean; createdAt: string; characterCount: number }
export interface AdminPostDTO extends PostSummaryDTO { deletedAt: string | null; closedReason: string | null; posterDiscordUsername: string }
```

- [ ] **Step 1: Write the failing test:** create a `Notification` and a `WebhookDelivery` for a guild. Deleting the user cascades its notifications; deleting the guild cascades its deliveries.
- [ ] **Step 2:** Run `npm test -w server -- notify.schema`. Expected: FAIL.
- [ ] **Step 3:** Edit the schema and run `npx -w server prisma migrate dev --name notifications_outbox`. Add the DTOs.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(db): notifications, webhook outbox, job runs`.

---

### Task 2: Discord message builders

**Files:**
- Create: `server/src/discord/messages.ts`
- Test: `server/test/discord.messages.test.ts`

**Interfaces:**
- Consumes: `PostSummaryDTO` (Plan 2), `POST_TYPE_LABELS`, `formatCp`-equivalent (add a server-side `formatCpShort` here, mirroring `web/src/components/card/format.ts` rules: 1.5B / 12.3M / 950K / 999).
- Produces:
  - `type WebhookPayload = { content?: string; embeds?: object[]; allowed_mentions: { parse: string[]; users?: string[] }; username?: string }`
  - `neutralize(text: string): string`: replaces `@everyone` and `@here` with `@​everyone` and `@​here`, and `<@` with `<@​`.
  - `discordTime(iso: string | null): string`: `'<t:1762800000:F> (<t:1762800000:R>)'`, or `'Flexible'`.
  - `buildNewPostMessage(post: PostSummaryDTO, webOrigin: string): WebhookPayload`:
    - **Embed title:** `"<POST_TYPE_LABELS[type]>: <boss labels joined ' + '>"`, with `url` set to the post link.
    - **Fields:** World, When (`discordTime`), Slots (`"<memberCount>/<partySize>"`, Recruiting only), Min CP (when set), Poster (`"<IGN> · <class> · Lv <level> · CP <short>"`), Guild, Discord (poster username), and Note (neutralized, ≤ 300 characters, omitted when empty).
    - `thumbnail.url` is the poster's image. Color is `0x3b82f6` for Recruiting and `0x22c55e` for LFP.
    - `allowed_mentions: { parse: [] }`.
  - `buildRequestPing(args: { recipientDiscordId: string; kind: 'join_request' | 'invite'; applicant: { ign: string; jobName: string; level: number; combatPower: number }; post: PostSummaryDTO; webOrigin: string }): WebhookPayload`:
    - `content` for a join request: `"<@ID> <IGN> (<class>, <level>, CP <short>) wants to join your <bosses> run → <link>"`.
    - `content` for an invite: `"<@ID> <posterIGN> invited <IGN> to their <bosses> run → <link>"`.
    - `allowed_mentions: { parse: [], users: [ID] }`.
  - `buildAcceptPing(args: { recipientDiscordId: string; ign: string; post: PostSummaryDTO; webOrigin: string }): WebhookPayload`: `"<@ID> <IGN> was accepted into <posterIGN>'s <bosses> run → <link>"`, with the same `allowed_mentions` rule.
  - `buildTestMessage(guildName: string): WebhookPayload`: `"✅ Party Finder is connected to <guildName>."`, `parse: []`.
  - `bossLabel(b: PostBossDTO): string` gives `"Hard Lucid"` (difficulty, then name).

- [ ] **Step 1: Write the failing tests:**
  - `bossLabel` gives "Hard Lucid".
  - `formatCpShort(1_500_000_000)` gives '1.5B'.
  - `discordTime('2025-11-10T20:00:00Z')` gives `'<t:1762804800:F> (<t:1762804800:R>)'`; `discordTime(null)` gives 'Flexible'.
  - `new post embed` has a title like 'Recruiting: Hard Lucid + Hard Will', a field 'Slots' = '2/4', a thumbnail, the post URL, and `allowed_mentions.parse` = [].
  - **Review focus 1:** a note of `'@everyone come <@123> @here'` yields a Note field without the literal substrings `'@everyone'`, `'@here'` or `'<@123>'`, and `allowed_mentions` = `{ parse: [] }`.
  - `request ping` content starts with `'<@555> Bob (Bishop, 275, CP 300M) wants to join your Hard Lucid run'`, and `allowed_mentions` = `{ parse: [], users: ['555'] }`.
  - `invite ping wording`; `accept ping wording`; `LFP embed has no Slots/Min CP fields`.
- [ ] **Step 2:** Run `npm test -w server -- discord.messages`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): Discord message builders with mention safety`.

---

### Task 3: Webhook sender, outbox, and worker

**Files:**
- Create: `server/src/discord/sender.ts`, `server/src/discord/outbox.ts`
- Modify: `server/test/helpers.ts` (`FakeWebhookSender`)
- Test: `server/test/discord.outbox.test.ts`

**Interfaces:**
- Produces:
  - `type SendResult = { ok: true } | { ok: false; status: number | null; retryAfterMs?: number; error: string }`
  - `interface WebhookSender { send(webhookUrl: string, payload: WebhookPayload): Promise<SendResult> }`
  - `class HttpWebhookSender implements WebhookSender`:
    - It POSTs JSON to `${url}?wait=true` with an 8s `AbortSignal.timeout`.
    - On 429 it reads `retry_after` (seconds) from the body.
    - The `error` text is `"HTTP <status>"`, or the error class name. It never includes the URL.
  - `enqueueDelivery(prisma | tx, guildId: string, eventType: string, payload: WebhookPayload): Promise<void>`
  - `class WebhookWorker { constructor(opts: { prisma; sender: WebhookSender; now?: () => Date; batchSize?: number /* 10 */ }); runOnce(): Promise<{ sent: number; retried: number; failed: number }>; start(intervalMs = 5000): void; stop(): Promise<void> }`
    - **`runOnce` selection:** in a transaction it selects up to `batchSize` `pending` rows with `nextAttemptAt <= now` using `FOR UPDATE SKIP LOCKED` (raw SQL), joined to the guild.
    - **Before sending:**
      - A guild without a `webhookUrl`, or with `active:false`, gets `status:'failed'`, `lastError:'Webhook not configured'`.
    - **After sending:**
      - On ok: `sent`, `sentAt`.
      - On 404 or 401: `failed`, `lastError: 'HTTP 404'`.
      - On 429: `nextAttemptAt = now + retryAfterMs`, and `attempts` is not incremented.
      - On any other failure: `attempts += 1`, and `nextAttemptAt = now + BACKOFF[attempts-1]`, where `BACKOFF = [30_000, 120_000, 600_000, 3_600_000]`. When `attempts >= 5` it becomes `failed`.
    - `start` and `stop` manage a `setInterval`. `stop` waits for an in-flight `runOnce`.
  - `FakeWebhookSender` has `queue(result)`, `calls: {url, payload}[]`, and defaults to `{ok:true}`.

- [ ] **Step 1: Write the failing tests** (fake sender, injected clock):
  - `pending delivery sent → status sent, sentAt set, 1 call with the guild's url`.
  - **Review focus 2:**
    - With `{ok:false,status:500}` the delivery stays pending with `attempts:1` and `nextAttemptAt = now+30s`.
    - A `runOnce` at `now+10s` sends nothing. At `now+31s` it retries and succeeds.
    - A later `runOnce` makes no additional call.
  - `429 with retryAfterMs 5000 → nextAttemptAt now+5s, attempts unchanged`.
  - **Review focus 3:** with a 404 result the delivery is `failed` right away. `lastError === 'HTTP 404'` and doesn't contain `'discord.com/api/webhooks'`.
  - `5 consecutive 500s → failed`.
  - `guild inactive or webhook removed after enqueue → failed 'Webhook not configured', no send`.
  - `HttpWebhookSender` with a stub `fetch` throwing `TypeError('fetch failed')`: the error is `'TypeError'` and contains no URL.
- [ ] **Step 2:** Run `npm test -w server -- discord.outbox`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): webhook outbox and retrying worker`.

---

### Task 4: Event dispatcher (notifications and enqueued pings)

**Files:**
- Create: `server/src/notifications/dispatcher.ts`
- Modify: `server/test/helpers.ts` (`buildTestApp` option `events: 'recording' | 'dispatcher'`, default `'recording'`)
- Test: `server/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: `DomainEvent` (Plan 2), `postInclude`/`toPostSummaryDTO`, `requestInclude`, the message builders (Task 2), `enqueueDelivery` (Task 3), `config.webOrigin`.
- Produces:
  - `class EventDispatcher implements DomainEvents { constructor(opts: { prisma; storage; webOrigin: string; log: { error(obj: object, msg: string): void } }); emit(e: DomainEvent): void; drain(): Promise<void> }`
    - `emit` starts async handling and returns immediately. Errors are caught and passed to `log.error` without the payload URLs.
    - `drain()` awaits all in-flight handlers (tests and shutdown use it).
  - Handling, by event:
    - **`post.created`:** load the post, then enqueue `buildNewPostMessage` for each guild that has `active`, a non-null `webhookUrl`, and a `GuildWorld` for the post's world.
    - **`request.created`:**
      - Join request: notify the poster user (kind `join_request`, text `"<IGN> wants to join your <bosses> run"`, link `/posts/:postId`). Enqueue `buildRequestPing` to the guild of the poster's character (the post's `guildId`), mentioning the poster's `discordId`.
      - Invite: notify the invitee (the character owner; kind `invite`, text `"<posterIGN> invited <IGN> to <bosses>"`). Enqueue the ping to the invitee character's guild.
    - **`request.accepted`:**
      - Join request: notify the applicant (kind `accepted`) and enqueue `buildAcceptPing` to the applicant character's guild.
      - Invite: notify the poster only (kind `accepted`, text `"<IGN> accepted your invite"`).
    - **`request.declined`:**
      - `auto:false` on a join request: notify the applicant. On an invite: notify the poster. Kind `declined`.
      - `auto:true`: notify the applicant or invitee (kind `auto_declined`, text `"The <bosses> party filled or the post closed"`).
    - **`member.left`** (Plan 2's event already carries `userId` and `ign`): `removedBy:'poster'` notifies `userId` (kind `removed`); `'self'` notifies the poster (kind `member_left`).
    - **Ignored:** `post.updated`, `post.closed`, `post.reopened`, `request.cancelled`.
    - Ping skip rules:
      - Skip if the target guild has no `webhookUrl`, is inactive, or the recipient user has no `discordId`.
      - Skip notifying the actor about their own action.
  - `index.ts`: `events: new EventDispatcher({ prisma, storage, webOrigin: config.webOrigin, log: app.log })`. Because the app logger exists only after `buildApp`, give the dispatcher a `setLogger` method, or build it with a logger shim; either is the implementer's choice. Shutdown awaits `dispatcher.drain()` before `prisma.$disconnect()`.

- [ ] **Step 1: Write the failing tests.** These are integration tests through the Plan 2 HTTP APIs with `buildTestApp({ events: 'dispatcher' })`, calling `await events.drain()` before asserting.
  - **Setup:** guilds G1 (Kronos, with a webhook), G2 (Kronos, no webhook), G3 (Bera, with a webhook) and G4 (Kronos, with a webhook, inactive).
  - **Review focus 4:** creating a Kronos Recruiting post gives exactly 1 `WebhookDelivery`, for G1, with `eventType 'post.created'`.
  - `join request → poster gets Notification kind join_request linking /posts/:id; one delivery to poster's guild with content containing <@posterDiscordId>`.
  - `invite → invitee notified; ping to invitee's guild`.
  - `accept join request → applicant notified kind accepted + accept ping to applicant's guild`.
  - `accept invite → poster notified, no ping`.
  - `manual decline → other side notified, no delivery`.
  - `fill party → auto-declined applicant gets auto_declined notification, no delivery`.
  - `poster removes member → member notified removed; member leaves → poster notified member_left`.
  - `post close / edit / cancel produce no notifications or deliveries`.
  - `dispatcher error (prisma rejects) is logged, emit does not throw, the HTTP response was already 201`.
- [ ] **Step 2:** Run `npm test -w server -- dispatcher`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w server`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(server): event dispatcher for notifications and Discord pings`.

---

### Task 5: Notifications API

**Files:**
- Create: `server/src/notifications/routes.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/notifications.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/notifications?limit=30` (requires user; `limit` 1..100) → `NotificationListDTO`. Items are newest first; `unreadCount` counts all unread notifications.
  - `POST /api/notifications/read` `{ ids?: string[]; all?: true }` (requires user) → 204. It only touches the viewer's own notifications; another user's IDs are silently ignored.
  - Notifications older than 60 days are pruned by the daily job (Task 7).

- [ ] **Step 1: Write the failing tests:**
  - `lists only my notifications newest first with unreadCount`.
  - `limit honored`.
  - `read {ids} marks those; read {all:true} marks all; other user's id unaffected`.
  - `visitor → 401`.
- [ ] **Step 2:** Run `npm test -w server -- notifications`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): notifications API`.

---

### Task 6: Admin webhook test and health

**Files:**
- Create: `server/src/admin/webhooks.ts`
- Modify: `server/src/app.ts` (`AppDeps.webhookSender: WebhookSender`; buildTestApp defaults it to `FakeWebhookSender`), `server/src/index.ts`
- Test: `server/test/admin.webhooks.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/admin/guilds/:id/test-webhook` (admin) → `{ ok: true }`, or `{ ok: false, error: string }` with 200. It sends `buildTestMessage` synchronously through `deps.webhookSender`. A guild without a webhook gets 400 `NO_WEBHOOK`. The test send is also recorded as a `WebhookDelivery` (`eventType 'test'`, with its final status) so it shows in health.
  - `GET /api/admin/webhooks/health` (admin) → `WebhookHealthDTO[]`, one per guild ordered by name:
    - `lastSentAt` comes from the last `sent` delivery.
    - `pending` is the pending count; `failedLast24h` counts failures in the last 24 hours.
    - `recentFailures` holds the last 10 failed deliveries.
  - Non-admin requests get 403 and visitors get 401.

- [ ] **Step 1: Write the failing tests:**
  - `test-webhook ok → {ok:true}, fake sender called with test payload, delivery recorded sent`.
  - `test-webhook 404 → {ok:false, error:'HTTP 404'} and the response text does not contain the webhook URL`.
  - `no webhook → 400 NO_WEBHOOK`.
  - **Review focus 3:** a failed delivery shows in health `recentFailures` with `lastError 'HTTP 404'`, and `JSON.stringify(health)` contains no `'discord.com/api/webhooks'`.
  - `non-admin → 403`.
- [ ] **Step 2:** Run `npm test -w server -- admin.webhooks`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(server): admin webhook test and health`.

---

### Task 7: Daily Nexon sync job

**Files:**
- Create: `server/src/jobs/dailySync.ts`
- Modify: `server/src/nexon/client.ts` (`findByName(ign, opts?: { fresh?: boolean })`: `fresh` skips the cache read but still writes the cache), `server/src/characters/service.ts` (`syncCharacterFromNexon(prisma, nexon, id, opts?: { fresh?: boolean })` passes `fresh` through), `server/test/helpers.ts` (`FakeNexon` records `fresh`)
- Test: `server/test/dailySync.test.ts`, `server/test/nexon.test.ts` (fresh case)

**Interfaces:**
- Produces:
  - `class DailySyncJob { constructor(opts: { prisma; nexon: NexonClient; now?: () => Date; sleep?: (ms: number) => Promise<void>; throttleMs?: number /* 2000 */ }); runIfDue(): Promise<'skipped' | { synced: number; stale: number }>; start(checkEveryMs = 3_600_000): void; stop(): Promise<void> }`
    - `runIfDue` reads `JobRun('daily-sync')` and returns `'skipped'` when `lastRunAt` is within 24h.
    - Otherwise it upserts `lastRunAt = now` first, so a crash doesn't cause a re-run storm.
    - It then iterates characters whose owner isn't banned, ordered by `lastSyncedAt` ascending. For each it calls `syncCharacterFromNexon(..., { fresh: true })` and `await sleep(throttleMs)` between calls.
    - Then it deletes notifications older than 60 days and sent deliveries older than 30 days.
    - It stores `lastResult` and never throws (per-character errors are counted as stale and logged).
  - `index.ts` starts `job.start()` and `worker.start()` after listen, and awaits `job.stop()` and `worker.stop()` on shutdown before `app.close()`.

- [ ] **Step 1: Write the failing tests:**
  - `nexon fresh:true bypasses cache (2 fetches)`.
  - `first run syncs all non-banned characters oldest first, throttles with sleep(2000) between, records JobRun`.
  - `second run within 24h → 'skipped'`; `run after 24h → runs`.
  - **Review focus 5 (sync part):** a banned user's character is not passed to Nexon.
  - `Nexon failure on one character → that one stale, others ok, run completes`.
  - `prunes 61-day-old notifications, keeps 59-day-old`.
- [ ] **Step 2:** Run `npm test -w server -- dailySync nexon`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w server`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(server): daily Nexon sync job with cache bypass and pruning`.

---

### Task 8: Moderation API and ban effects

**Files:**
- Create: `server/src/admin/moderation.ts`
- Modify: `server/src/characters/service.ts` (`listCharacters` excludes banned owners unless `mine`), `server/src/posts/service.ts` (board excludes posts whose `posterUser.banned`), `server/src/auth/routes.ts` (banned callback → `/?login=banned`), `server/src/app.ts`
- Test: `server/test/admin.moderation.test.ts`

**Interfaces:**
- Consumes: `deleteCharacter` (Plan 2's version), the auto-decline helper, `requireAdmin`, `DomainEvents`.
- Produces:
  - `GET /api/admin/users?q=` → `AdminUserDTO[]`: prefix match on username, case-insensitive, limit 50, newest first. `isAdmin` comes from config.
  - `PATCH /api/admin/users/:id` `{ banned: boolean }` → `AdminUserDTO`:
    - Banning yourself or any configured admin gives 400 `CANNOT_BAN_ADMIN`.
    - On ban, in one transaction: close the user's open and full posts (`closedReason:'banned'`) and auto-decline pending requests and invites on those posts plus the user's own pending requests. Emit the matching events after commit.
    - Unban only flips the flag.
  - `GET /api/admin/users/:id/characters` → `CharacterDTO[]` (including those hidden by the ban).
  - `POST /api/admin/characters/:id/reassign` `{ userId }` → `CharacterDTO`:
    - Moves ownership. The target user must exist and not be banned, else 400 `VALIDATION`.
    - Pending requests from this character are cancelled (`request.cancelled`). Existing party memberships keep their rows; the `PostMember.userId` of those rows moves to the new owner.
  - `DELETE /api/admin/characters/:id` → 204, via the same `deleteCharacter` service (party snapshots preserved).
  - `GET /api/admin/posts?status=open|full|closed|deleted|all&q=` → `AdminPostDTO[]` (newest first, limit 100; `q` matches the poster IGN prefix). Admin hard delete stays as in Plan 2.
  - Auth callback: if the upserted user is banned, it doesn't set the session and redirects to `${webOrigin}/?login=banned`.

- [ ] **Step 1: Write the failing tests:**
  - `non-admin → 403 on every moderation route`.
  - `users search by prefix`.
  - **Review focus 5:** banning `u-2`:
    - closes their open post (closedReason banned) and declines their pending join request;
    - their character disappears from `GET /api/characters`, and their posts from `GET /api/posts`;
    - their next login callback redirects to `/?login=banned`;
    - the event list includes `post.closed{reason:'banned'}`.
  - `cannot ban admin-1 → 400 CANNOT_BAN_ADMIN`.
  - `unban restores visibility`.
  - `reassign moves character to u-3; u-3 can now edit it; u-2 cannot; party membership userId moved`.
  - `admin delete character keeps party snapshot`.
  - `admin posts list with status=deleted includes soft-deleted party posts`.
- [ ] **Step 2:** Run `npm test -w server -- admin.moderation`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` (root). Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(server): moderation — bans, reassign, admin post list`.

---

### Task 9: Web — notification bell

**Files:**
- Create: `web/src/api/notifyHooks.ts`, `web/src/components/NotificationBell.tsx`, `web/src/components/bell.css`
- Modify: `web/src/components/Layout.tsx`
- Test: `web/test/bell.test.tsx`

**Interfaces:**
- Produces:
  - `useNotifications()`:
    - Query key `['notifications']`.
    - `refetchInterval: 30_000`, plus a refetch on window focus. Enabled only when logged in.
  - `useMarkRead()`: a mutation that invalidates `['notifications']`.
  - `<NotificationBell />` in the Layout header for logged-in users:
    - **Button:** a bell icon with an unread badge showing `unreadCount`, capped at "9+". Its `aria-label` is "Notifications, N unread".
    - **Dropdown:** a list of up to 30 notifications with a relative time ("5m ago"). Unread items are bold.
    - **Clicking an item** marks it read and navigates to its `link`.
    - **"Mark all read"** marks every notification read.
    - **Empty state:** "You're all caught up."
    - It closes on Escape or an outside click. On phones it opens as a full-width sheet.
  - Layout also shows a "Your account has been banned." banner when `?login=banned` is present, using the same pattern as Plan 1's login-failed banner.
  - When a notification arrives, the bell also invalidates `['posts']`, so open post pages pick up lineup changes.

- [ ] **Step 1: Write the failing tests:**
  - `badge shows 3; 12 unread shows 9+; hidden at 0`.
  - `opening lists items; clicking one posts /api/notifications/read {ids:[id]} and navigates to its link`.
  - `Mark all read posts {all:true}`.
  - `empty state`.
  - `not rendered when logged out`.
  - `?login=banned shows banned banner`.
- [ ] **Step 2:** Run `npm test -w web -- bell`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): notification bell`.

---

### Task 10: Web — admin webhooks (test button and health tab)

**Files:**
- Create: `web/src/pages/admin/WebhooksAdmin.tsx`
- Modify: `web/src/pages/admin/GuildsAdmin.tsx` (Send test message button), `web/src/pages/admin/AdminLayout.tsx` (tab), `web/src/App.tsx` (route `/admin/webhooks`), `web/src/api/hooks.ts` (`useTestWebhook`, `useWebhookHealth`)
- Test: `web/test/adminWebhooks.test.tsx`

**Interfaces:**
- Produces:
  - **GuildsAdmin:** each guild row with a webhook gets a "Send test message" button, which shows inline "Sent ✓" or "Failed: HTTP 404".
  - **WebhooksAdmin** ("Webhooks" tab):
    - **Table**, one row per guild: name, webhook ✓/—, active, last sent (relative), pending, failed in the last 24h.
    - **Status pill:** red when `failedLast24h > 0`, gray when there is no webhook.
    - **Row expansion:** a row expands to show `recentFailures` (event, attempts, error, time).
    - **Refresh:** a "Refresh" button refreshes; the data also refetches every 60 s while the page is open.

- [ ] **Step 1: Write the failing tests:**
  - `test button posts /api/admin/guilds/g1/test-webhook and shows Sent ✓; error shows Failed: HTTP 404`.
  - `health table rows and failure expansion`.
  - `red pill when failedLast24h>0`.
- [ ] **Step 2:** Run `npm test -w web -- adminWebhooks`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): admin webhook test and health`.

---

### Task 11: Web — admin users and posts moderation

**Files:**
- Create: `web/src/pages/admin/UsersAdmin.tsx`, `web/src/pages/admin/PostsAdmin.tsx`
- Modify: `web/src/pages/admin/AdminLayout.tsx` (tabs Users, Posts), `web/src/App.tsx` (routes), `web/src/api/hooks.ts` (admin moderation hooks, invalidating `['admin']`, `['characters']`, `['posts']`)
- Test: `web/test/adminModeration.test.tsx`

**Interfaces:**
- Produces:
  - `UsersAdmin`:
    - **Search:** a search box with a 300 ms debounce, then a list (avatar, Discord username, admin badge, banned pill, character count).
    - **Ban/Unban:** a button per user. Ban asks for confirmation: "Ban <name>? Their open posts will close." Admins get no ban button.
    - **Expanding a user** lists their characters as small cards, each with:
      - "Reassign…", which opens a user search and picker, then POSTs the reassign.
      - "Delete", which asks for confirmation.
  - `PostsAdmin`:
    - **Filters:** a status filter (All / Open / Full / Closed / Deleted) and an IGN search.
    - **List:** rows with type, bosses, poster plus Discord username, world, status, closed reason, and created time.
    - **Row actions:** "View" (links to `/posts/:id`, which the admin can see) and "Delete permanently" (with a confirm), which calls the Plan 2 admin delete.

- [ ] **Step 1: Write the failing tests:**
  - `search users debounced → GET /api/admin/users?q=bo`.
  - `Ban confirms then PATCHes {banned:true}`.
  - `no ban button for admin users`.
  - `reassign flow posts {userId}`.
  - `delete character confirms then DELETEs`.
  - `posts filter Deleted → GET /api/admin/posts?status=deleted`.
  - `Delete permanently confirms then DELETEs /api/admin/posts/:id`.
- [ ] **Step 2:** Run `npm test -w web -- adminModeration`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -w web`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat(web): admin users and posts moderation`.

---

### Task 12: Production wiring, docs, end-to-end check

**Files:**
- Modify: `server/src/index.ts`, `README.md`, `.env.example`
- Test: `server/test/wiring.test.ts`

**Interfaces:**
- Produces:
  - `index.ts` builds the `EventDispatcher`, `HttpWebhookSender`, `WebhookWorker`, and `DailySyncJob`, and starts the worker (every 5 s) and the job (check hourly) after `listen`.
  - Shutdown order: `job.stop()` → `worker.stop()` → `dispatcher.drain()` → `app.close()` → `prisma.$disconnect()`.
  - Env `JOBS_ENABLED` (default `true`): when `false`, neither timer starts. Useful when running a second instance.
  - **README "Discord channel setup":**
    - In Discord, go to Server Settings → Integrations → Webhooks → New Webhook, pick the channel, and copy the URL.
    - In the app, open Admin → Guilds, paste the URL, then click Send test message.
    - Members must be in that Discord server for @mentions to work.
  - **README "Notifications & jobs":** explains the bell polling, the daily sync time (24h after the last run), and webhook retries.

- [ ] **Step 1: Write the failing test.** `wiring.test.ts` uses `buildTestApp({ events: 'dispatcher' })` with a real `WebhookWorker` and a `FakeWebhookSender`, and drives this flow end to end:
  1. Create a post: one delivery is enqueued.
  2. `worker.runOnce()`: the fake sender receives an embed titled 'Recruiting: Hard Lucid'.
  3. A join request: the poster gets a notification, and after `runOnce` the fake sender receives a ping containing `<@posterDiscordId>`.
  4. Accept: the applicant gets a notification and an accept ping is sent.
- [ ] **Step 2:** Run `npm test -w server -- wiring`. Expected: FAIL until index wiring helpers exist (if the test exposes a missing export or behavior; otherwise it passes immediately because the earlier tasks are complete. In that case, record that it passed straight away and proceed).
- [ ] **Step 3:** Implement the `index.ts` wiring, `JOBS_ENABLED`, and the README and `.env.example` updates.
- [ ] **Step 4:** Run `npm test` (root). Expected: all PASS. Then run `docker compose -f docker-compose.prod.yml up -d --build` with a throwaway `.env` that sets `JOBS_ENABLED=true` and a fake webhook URL on a seeded guild; this can be skipped if no admin login is possible. Then check:
   - `curl -s localhost:3000/api/health` returns `{"ok":true}`.
   - The container logs show the worker and job started without errors.
   - Run `docker compose -f docker-compose.prod.yml down`.
- [ ] **Step 5:** Commit: `feat: wire notifications, webhook worker and daily sync into production`.

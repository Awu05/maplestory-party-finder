# Run Reminders and Typed Discord IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Posters set "N minutes/hours/days before" reminders that post into the party chat thread (pinging members) and the in-app bell; sign-up requires a typed Discord user ID so unlinked members can be pinged too.

**Architecture:** A typed ID lives in `User.typedDiscordId`, separate from the sign-in `discordId`; one helper resolves each member's pingable ID. The webhook worker records the party thread's `channel_id` on `Post.partyThreadId`. A new `RunReminderJob` claims due reminders via a `PostReminderSent` row keyed on (post, offset, runAt), writes bell notifications, and queues a `post.run_reminder` delivery that the worker sends with `?thread_id=`.

**Tech Stack:** Fastify, Prisma/Postgres, zod, Vitest; React/TS web with Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-13-run-reminders-design.md`

## Global Constraints

- Migrations via `npx prisma migrate dev --name <name>` from `server/`; never `prisma migrate reset`. DB via `npm run dev:db` only.
- Never touch `.env` or `server/.env`.
- Discord ID format: `/^[1-9]\d{16,19}$/`, after removing `[\p{Cc}\p{Cf}]` and trimming.
- Reminders: at most 3 per post; each 5 to 10080 minutes (7 days); stored as sorted unique whole minutes; recruiting/carrying only.
- A reminder more than 15 minutes (`MAX_REMINDER_LATENESS_MS = 15 * 60_000`) late is recorded, not sent.
- All user text in Discord messages goes through `neutralize()` and `clip()`; `allowed_mentions: { parse: [], users: [...] }`.
- Error code `DISCORD_ID_TAKEN` (409): "That Discord ID is already used by another account."
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `.superpowers/`.
- If web tests fail en masse with "Invalid Chai property", delete `node_modules/.vitest-cache`.

## Review Focus

1. Time changed after a reminder fired: the new time gets its own reminders (new `runAt`), and the old queued delivery is dropped (Task 6 test `reschedule`).
2. Poster removes an offset after the delivery was queued: worker drops it (Task 6 test `offset removed`).
3. Reopened post then re-finalized: reminders never go to the old thread (Task 4 test `reopen clears thread`).
4. Weekly post advanced by `WeeklyReminderJob`: next week's reminders fire once, not twice (Task 6 test `weekly next occurrence`).
5. A typed ID pasted with spaces or a zero-width character is accepted; one already linked by another account is refused (Task 1 tests).

---

### Task 1: Typed Discord ID on the server

**Files:**
- Modify: `server/prisma/schema.prisma` (User: `typedDiscordId String? @unique`; PasskeyChallenge: `typedDiscordId String?`), new migration `typed_discord_id`
- Modify: `server/src/auth/localAuth.ts`, `server/src/auth/passwords.ts`, `server/src/auth/passkeys.ts`, `server/src/auth/routes.ts`, `server/src/auth/serialize.ts`, `shared/src/types.ts`
- Create: `server/src/auth/discordIds.ts`
- Test: `server/test/passwords.test.ts`, `server/test/passkeys.test.ts`, `server/test/profile.test.ts`, `server/test/linkDiscord.test.ts`, `server/test/discordOAuth.test.ts`; update `server/test/helpers.ts` signup helpers and any fixtures that sign up (add a valid ID)

**Interfaces:**
- Produces: `discordUserIdField` (zod, in `localAuth.ts`); `signupBody` now `{ discordUsername, discordUserId, displayName }`; `ensureDiscordIdAvailable(db, id: string, selfUserId?: string): Promise<void>` throws `DISCORD_ID_TAKEN`; `isDiscordIdConflict(err): boolean` (P2002 on `typedDiscordId`); `clearTypedDiscordId(tx, verifiedId: string): Promise<void>` (sets `typedDiscordId: null` on every user holding it); `MeDTO` gains `discordUserId: string | null` (= `typedDiscordId` for unlinked, `discordId` for linked).

- [ ] **Step 1: Write failing tests**
  - passwords: `register requires a Discord user ID` → 400 VALIDATION without it; `register stores a typed ID, stripping spaces and zero-width characters` (`' 123456789012345678​'` → `typedDiscordId === '123456789012345678'`, `discordId === null`); `register refuses an ID a linked account uses` → 409 `DISCORD_ID_TAKEN`; `register refuses an ID another account typed` → 409.
  - passkeys: options require `discordUserId`; verify creates the user with it; taken ID refused at options.
  - profile: `PATCH /auth/me { discordUserId }` saves for unlinked; 400 `DISCORD_LINKED` for linked; 409 when taken; `/auth/me` returns `discordUserId`.
  - linkDiscord: linking with verified ID X clears `typedDiscordId` on the linker and on another account that typed X.
  - discordOAuth: a first Discord sign-in with ID X clears another account's typed X.
- [ ] **Step 2: Run** `cd server && npx vitest run test/passwords.test.ts test/passkeys.test.ts test/profile.test.ts test/linkDiscord.test.ts test/discordOAuth.test.ts` — expect the new tests to FAIL.
- [ ] **Step 3: Implement.** Schema + migration. `discordUserIdField` mirrors `discordUsernameField`'s cleaning then `.regex(/^[1-9]\d{16,19}$/, 'Enter your Discord user ID: the 17 to 20 digit number from Copy User ID.')`. Password register and passkey options call `ensureDiscordIdAvailable` before work; passkey challenge stores the ID; create sets `typedDiscordId`; P2002 on `typedDiscordId` maps to `DISCORD_ID_TAKEN` (check before the generic P2002 branches). `profileBody` gets `discordUserId: discordUserIdField.optional()` with the same unlinked-only rule as the username. Both OAuth branches call `clearTypedDiscordId(tx, profile.discordId)` inside their transaction.
- [ ] **Step 4: Run** the Step 2 command, then `npm test -w server` — all PASS.
- [ ] **Step 5: Commit** `feat(auth): sign-up asks for a Discord user ID so unlinked accounts can be pinged`

### Task 2: Typed Discord ID on the web

**Files:**
- Modify: `web/src/components/LoginDialog.tsx`, `web/src/components/ProfileDialog.tsx`, `web/src/api/hooks.ts` (`useUpdateProfile` input), `web/src/api/errors.ts`
- Test: `web/test/` login/sign-up and profile tests (find with `grep -l "password/register\|ProfileDialog" web/test`); add `discordUserId` to `MeDTO` fixtures where typecheck requires it

**Interfaces:**
- Consumes: Task 1's request field `discordUserId` and `MeDTO.discordUserId`.

- [ ] **Step 1: Write failing tests:** sign-up form has a required "Discord user ID" input (`inputMode="numeric"`) with the help text "In Discord, turn on Settings → Advanced → Developer Mode, then right-click your name and choose Copy User ID."; both password and passkey register requests send `discordUserId` trimmed; profile dialog for an unlinked account shows and saves the ID, linked account does not show it; `DISCORD_ID_TAKEN` shows the friendly message.
- [ ] **Step 2: Run** `npm test -w web -- <files>` — FAIL.
- [ ] **Step 3: Implement** following the existing Discord username field pattern in each dialog.
- [ ] **Step 4: Run** `npm test -w web` and `npm run typecheck` (or the repo's equivalent) — PASS.
- [ ] **Step 5: Commit** `feat(web): Discord user ID field at sign-up and in the profile`

### Task 3: Ping typed IDs everywhere

**Files:**
- Create: `server/src/discord/pingable.ts`
- Modify: `server/src/discord/messages.ts` (`buildPartyThread` roster), `server/src/posts/service.ts` (`requestPartyThread`), `server/src/discord/outbox.ts` (forum rebuild members), `server/src/discord/weeklyRecipients.ts`, `server/src/notifications/dispatcher.ts` (`ping`)
- Test: `server/test/discord.messages.test.ts`, `server/test/partyForumThread.test.ts`, `server/test/weeklyReminders.test.ts`, `server/test/dispatcher.test.ts`

**Interfaces:**
- Produces: `pingableId(user: { discordId: string | null; typedDiscordId: string | null }): { id: string; verified: boolean } | null`; roster member type becomes `{ ign: string; discordId: string | null; verified?: boolean; discordUsername?: string }` (`verified` defaults true).

- [ ] **Step 1: Write failing tests:** roster renders typed member as `• Lily: <@123456789012345678> (unverified)` and puts the ID in `allowed_mentions.users`; `weeklyRecipientIds` includes typed IDs, still skips banned/deleted, de-duplicates; request ping goes to a member who only has a typed ID; a member with neither is still listed by name without a ping.
- [ ] **Step 2: Run** those four test files — FAIL.
- [ ] **Step 3: Implement:** add `typedDiscordId: true` to the user selects in each caller and map through `pingableId`.
- [ ] **Step 4: Run** `npm test -w server` — PASS.
- [ ] **Step 5: Commit** `feat(discord): typed Discord IDs are pinged like linked ones`

### Task 4: Remember the party thread and send into it

**Files:**
- Modify: `server/prisma/schema.prisma` (Post: `partyThreadId String?`), migration `party_thread_id`
- Modify: `server/src/discord/sender.ts`, `server/src/discord/outbox.ts`, `server/src/posts/service.ts` (reopen), `server/test/helpers.ts` (`FakeWebhookSender`)
- Test: `server/test/discord.outbox.test.ts`, `server/test/partyForumThread.test.ts`, `server/test/posts.lifecycle.test.ts`

**Interfaces:**
- Produces: `SendResult` ok branch becomes `{ ok: true; channelId?: string }`; `WebhookSender.send(webhookUrl, payload, opts?: { threadId?: string })`; URL `${webhookUrl}?wait=true&thread_id=${threadId}` when given. `FakeWebhookSender.calls` entries gain `threadId?`.

- [ ] **Step 1: Write failing tests:** `HttpWebhookSender` returns `channelId` from the JSON body's `channel_id` and appends `thread_id`; a sent `post.party_thread` sets `post.partyThreadId` to the returned channel; `reopen clears thread` — reopening sets `partyThreadId` to null.
- [ ] **Step 2: Run** those test files — FAIL.
- [ ] **Step 3: Implement.** Read the body only when `res.ok` (ignore parse errors). On a successful party thread send, `prisma.post.updateMany({ where: { id: postId }, data: { partyThreadId: res.channelId } })` when present. Reopen's update adds `partyThreadId: null`.
- [ ] **Step 4: Run** `npm test -w server` — PASS.
- [ ] **Step 5: Commit** `feat(discord): remember each party chat thread`

### Task 5: Reminder offsets on posts

**Files:**
- Modify: `server/prisma/schema.prisma` (Post: `reminderOffsets Int[] @default([])`, relation `remindersSent PostReminderSent[]`; new model `PostReminderSent` exactly as in the spec), migration `run_reminders`
- Modify: `server/src/posts/routes.ts`, `server/src/posts/service.ts`, `server/src/posts/serialize.ts`, `shared/src/types.ts`
- Test: `server/test/posts.create.test.ts`, `server/test/posts.edit.test.ts`; add `reminderOffsets: []` to web `PostSummaryDTO` fixtures so typecheck passes

**Interfaces:**
- Produces: `PostSummaryDTO.reminderOffsets: number[]`; request field `reminderOffsets?: number[]` on create and edit.

- [ ] **Step 1: Write failing tests:** create stores `[15, 1440]` sorted and de-duplicated from `[1440, 15, 15]`; 400 for 4 entries, for an offset of 4, for 10081, for non-integers; 400 when type is `lfp` and offsets non-empty; edit replaces offsets; edit omitting the field keeps them; DTO exposes them.
- [ ] **Step 2: Run** those files — FAIL.
- [ ] **Step 3: Implement:** `reminderOffsetsSchema = z.array(z.number().int().min(5).max(10080)).transform(sortUnique).pipe(z.array(z.number()).max(3))`; changing type to LFP clears offsets.
- [ ] **Step 4: Run** `npm test -w server` and `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(posts): posters can set reminders before the run`

### Task 6: The reminder job and its Discord message

**Files:**
- Create: `server/src/jobs/runReminders.ts`
- Modify: `server/src/discord/messages.ts` (`buildRunReminder`, `reminderLabel`), `server/src/discord/outbox.ts` (`post.run_reminder`), `server/src/notifications/dispatcher.ts` (export the kind union with `'reminder'`), `server/prisma/schema.prisma` Notification kind comment, `server/src/index.ts`
- Test: create `server/test/runReminders.test.ts`; extend `server/test/discord.messages.test.ts`, `server/test/discord.outbox.test.ts`, `server/test/wiring.test.ts`

**Interfaces:**
- Consumes: `pingableId` (Task 3), `partyThreadId` and `send(..., { threadId })` (Task 4), `reminderOffsets`/`PostReminderSent` (Task 5).
- Produces: `class RunReminderJob { constructor(opts: { prisma; webOrigin: string; log?: Logger }); runOnce(now?: Date): Promise<number>; start(checkEveryMs = 30_000): void; stop(): Promise<void> }`; `reminderLabel(minutes: number): string` ("15 minutes", "1 hour", "1 hour 30 minutes", "2 days"); `buildRunReminder(input: { post: { id: string; title: string; bosses: PostBossDTO[] }; runAt: Date; pinged: string[]; unpinged: string[]; webOrigin: string }): WebhookPayload`; payload marker `_reminder: { runAt: string; offsetMinutes: number }`.

- [ ] **Step 1: Write failing tests** in `runReminders.test.ts` (finalized post, `scheduledAt = T`, offsets `[15, 1440]`, members with linked, typed and no ID, thread ID set):
  - at `T - 15min`: one `PostReminderSent` row for 15, bell notification kind `reminder` for every member including the poster with text "Reminder: {title or bosses} starts in 15 minutes", one `post.run_reminder` delivery with `_reminder.runAt = T`.
  - second `runOnce` at the same time: nothing new.
  - `late`: offsets `[1440]` only, `runOnce` at `T - 1440min + 16min` (16 minutes past due, still before T): row recorded, no notification, no delivery.
  - `closest only`: at `T - 10min` with both offsets due: 15 sent, 1440 recorded unsent.
  - no thread ID: bell notifications, no delivery.
  - closed manually, deleted, poster banned, flexible, LFP: nothing.
  - `reschedule`: after sending for T, the time moves to T2; at `T2 - 15min` sends again; the worker drops a still-queued delivery whose `_reminder.runAt` ≠ current `scheduledAt`.
  - `weekly next occurrence`: weekly post, run at T, `WeeklyReminderJob` advances to T+7d; reminders fire once for T+7d.
  - Rows with `runAt` older than 7 days are deleted by `runOnce`.
  - Outbox: `post.run_reminder` sends to the party forum webhook with `threadId`, rebuilds pings from current members (a member who left is not pinged), drops when the run started, the post is not active-finalized, or `offset removed` from `reminderOffsets`; a 404 fails it and sets `partyThreadId` null.
  - messages: `buildRunReminder` content matches the spec template, uses `<t:unix:R>`/`<t:unix:F>`, includes "Unpinged:" line only when there are unpinged names, neutralizes the title.
  - wiring: `index.ts` constructs and starts/stops `RunReminderJob` alongside the other jobs.
- [ ] **Step 2: Run** `cd server && npx vitest run test/runReminders.test.ts test/discord.messages.test.ts test/discord.outbox.test.ts test/wiring.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Due query (raw SQL, `FOR UPDATE OF p SKIP LOCKED`, `LIMIT 1` loop like `WeeklyReminderJob`): `scheduledAt > now`, `(status = 'closed' AND closedReason = 'finalized') OR weeklyTimeZone IS NOT NULL` with status open/full/finalized, `deletedAt IS NULL`, type in recruiting/carrying, poster not banned/deleted, and `EXISTS unnest(reminderOffsets) o WHERE scheduledAt - o * interval '1 minute' <= now AND NOT EXISTS PostReminderSent(post, o, scheduledAt)`. In the claim transaction insert rows for every due offset (`createMany`, `skipDuplicates`), send only the smallest due offset if it is not over the lateness limit. Worker: `post.run_reminder` uses `partyForumWebhookUrl` and the post's `partyThreadId`; add it to `POST_DELIVERIES` and to the partyForum destination check; rebuild with `buildRunReminder` from current members.
- [ ] **Step 4: Run** `npm test -w server` and `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(reminders): remind the party chat and members before the run`

### Task 7: Reminders on the web

**Files:**
- Create: `web/src/components/ReminderEditor.tsx`
- Modify: `web/src/pages/NewPostPage.tsx`, `web/src/api/postHooks.ts` (`PostInput.reminderOffsets?`), `web/src/pages/PostDetailPage.tsx`, `web/src/lib/` (shared `reminderLabel` — move it to `shared/src` if both sides use it), `README.md`
- Test: `web/test/newPost.test.tsx`, `web/test/postDetail.test.tsx`

**Interfaces:**
- Produces: `ReminderEditor({ value: number[]; onChange(next: number[]): void; disabled?: boolean })` — rows of a number input and a minutes/hours/days select, "Add reminder" hidden at 3, a remove button per row.

- [ ] **Step 1: Write failing tests:** the Reminders section appears for recruiting/carrying, hides for LFP; adding "1 day" and "15 minutes" sends `reminderOffsets: [15, 1440]` on create; editing an existing post pre-fills and sends only when changed (`changedFields`); a value under 5 minutes or over 7 days shows an inline error and blocks submit; detail page shows "Reminders: 15 minutes and 1 day before" and nothing when empty; help text says reminders start once the time is finalized.
- [ ] **Step 2: Run** those files — FAIL.
- [ ] **Step 3: Implement**; README gets "Run reminders" and "Discord user ID" bullets.
- [ ] **Step 4: Run** root `npm test`, `npm run typecheck`, `npm run build` — all PASS.
- [ ] **Step 5: Commit** `feat(web): set and show run reminders`

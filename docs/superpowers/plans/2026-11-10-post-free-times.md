# Post Free Times Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace a post's single date/time picker with a weekly free-time grid kept in the poster's own time zone, and let the poster of a Recruiting post finalize an exact time later through a popup that notifies the party.

**Architecture:**
- **Data:** `Post.freeTimes` holds local hour-of-week in the poster's IANA zone, stored as `Post.freeTimesZone`. `Post.scheduledAt` becomes "the final time".
- **Time math:** pure `Intl`-based helpers in `shared/` convert between zones, handling daylight saving. Postgres `AT TIME ZONE` does the Board's Free-at match.
- **Finalize:** a new `PUT /posts/:id/final-time` emits `post.finalized`. The dispatcher turns that into in-app notifications and Discord pings.

**Tech Stack:** Fastify 5, Prisma 6 + Postgres 16, zod 4, React 18 + TanStack Query 5, Vitest + Testing Library, plain CSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-post-free-times-design.md`

## Global Constraints

- **Migrations:** never run `prisma migrate reset` and never drop the dev database. Create migrations with `npx -w server prisma migrate dev --name <name>`. If Prisma refuses non-interactively, use `--create-only`, inspect the SQL, then run `migrate dev`.
- **Secrets and Docker:** never create, modify or delete `.env` or `server/.env`. Don't run docker compose. Postgres is already running.
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `.superpowers/`.
- **Server time zone:** never use the server's local time zone. No `getHours()`, `getDay()`, `getTimezoneOffset()` or `setHours()` on the server or in shared helpers; use `Intl` with an explicit `timeZone`, or UTC methods.
- **Hour-of-week encoding:** `day * 24 + hour`, where day 0 = Sunday. Values run 0–167.
- **freeTimes validation:** unique ints 0–167, at most 168. `freeTimesZone` must be a valid IANA zone, and it is required when `freeTimes` is non-empty.
- **Copy, verbatim:**
  - "When you're free"
  - "Leave empty if you're flexible"
  - "Final time: "
  - "Time not set yet"
  - "Flexible"
  - "Free times"
  - "Finalize time"
  - "Change time"
  - "Shown in your time zone (<zone>)"
  - "Not set yet — see free times on the post"
  - "Not set" (When chip)
  - "Free at"
  - "Any time"
- **Finalize rules:**
  - poster only, else 403 `NOT_OWNER`
  - recruiting only, else 409 `WRONG_POST_TYPE`
  - the post must be open or full, not deleted and not expired, else 409 `POST_CLOSED`
  - the time must be within `assertScheduleWindow` (5 minutes ago to 30 days ahead), else 400 `VALIDATION`
- **Verification before each commit:** `npm test` (shared, server, web) passes, `npx -w server tsc --noEmit` and `npx -w web tsc --noEmit` are clean, and `npm run build -w web` succeeds.
- **Phones and keyboard:** pages work at 375px wide; the grid may scroll sideways inside its own box. Grid cells toggle with Enter and Space, and focus stays visible.

## Review Focus

1. **DST boundary:** a New York post's "Tue 8pm" shows to a London viewer as Wed 1am in a week before the US clock change and Wed 0am in the week after. The helpers must use the poster-zone week containing `now`. Test in Task 1.
2. **Free at, across zones:** a Los Angeles viewer filtering Free at "Tue 5pm" finds a New York post free "Tue 8pm", and doesn't find it for "Tue 8pm". Test in Task 2.
3. **Edit leaves the final time alone:** editing a finalized post (bosses, note or grid) must not change `scheduledAt` or `expiresAt`. Test in Task 2.
4. **Re-finalize:** changing an already finalized time updates `expiresAt` and notifies the members again, but never the poster. Test in Task 3.
5. **Old posts:** posts with no zone (`freeTimesZone` null and an empty grid) render as "Flexible" everywhere and never match Free at. Tests in Tasks 2 and 5.

---

### Task 1: Shared time-zone helpers

**Files:**
- Create: `shared/src/zonedTime.ts`, `shared/test/zonedTime.test.ts`
- Modify: `shared/src/index.ts`, to export the helpers.
- Delete: `shared/src/playTimes.ts`, its test and its export. They are unused since the manual-characters work, and the new helpers replace them.

**Interfaces (Produces):**
- `type WallTime = { year: number; month: number /* 1-12 */; day: number; hour: number }`
- `isValidTimeZone(zone: string): boolean`
- `instantToZoned(date: Date, zone: string): WallTime & { dayOfWeek: number /* 0=Sun */ }`
- `zonedToInstant(wall: WallTime, zone: string): Date`
  - In the spring-forward gap it returns the next valid hour. In the fall-back overlap it returns the first occurrence.
- `freeSlotsForViewer(freeTimes: number[], posterZone: string, viewerZone: string, now: Date): number[]`
  - For each slot it takes the wall time `slot` hours after Sunday 00:00 of the poster-zone week containing `now`, converts that to an instant, then returns the viewer-zone hour-of-week.
  - The result is deduplicated and sorted.
  - If both zones are equal it returns the input, deduplicated and sorted.
- `nextOccurrence(hourOfWeek: number, zone: string, now: Date): Date`
  - Returns the first instant at or after the start of `now`'s current hour (in `zone`) whose zoned `dayOfWeek * 24 + hour` equals `hourOfWeek`.

- [ ] **Step 1: Write the failing tests** in `zonedTime.test.ts`. NY means America/New_York:
  - `isValidTimeZone`: 'America/New_York' is true; 'Mars/Base' and '' are false.
  - `zonedToInstant`, ordinary hour: `{2026,11,10,20}` in NY is `2026-11-11T01:00:00.000Z`.
  - `zonedToInstant`, spring gap: `{2026,3,8,2}` in NY is `2026-03-08T07:00:00.000Z`.
  - `zonedToInstant`, fall overlap: `{2026,11,1,1}` in NY is `2026-11-01T05:00:00.000Z`.
  - `instantToZoned(new Date('2026-11-11T01:00:00Z'), 'America/New_York')` gives `{year:2026, month:11, day:10, hour:20, dayOfWeek:2}`.
  - `freeSlotsForViewer`:
    - `([68], 'America/New_York', 'America/Los_Angeles', new Date('2026-11-10T15:00:00Z'))` gives `[65]`.
    - `([68], NY, 'Europe/London', new Date('2026-03-05T12:00:00Z'))` gives `[73]`.
    - `([68], NY, 'Europe/London', new Date('2026-03-10T12:00:00Z'))` gives `[72]` (Review Focus 1).
    - `([68], NY, 'Asia/Kolkata', new Date('2026-11-10T15:00:00Z'))` gives `[78]`.
    - Same zone: `([5, 3, 3], NY, NY, now)` gives `[3, 5]`.
  - `nextOccurrence` with `now = new Date('2026-11-10T15:00:00Z')` in NY:
    - `68` gives `2026-11-11T01:00:00.000Z`.
    - `58` gives `2026-11-10T15:00:00.000Z`, because the current hour counts.
    - `57` gives `2026-11-17T14:00:00.000Z`.
- [ ] **Step 2: Run** `npm test -w shared -- zonedTime`. Expect FAIL (module missing).
- [ ] **Step 3: Implement** with `Intl.DateTimeFormat(..., { timeZone, hourCycle: 'h23', year, month, day, hour, weekday })` and `formatToParts`.
  - `zonedToInstant` guesses an instant with `Date.UTC`, reads the zone's offset at that guess, corrects, and re-checks once.
  - If the corrected instant's zoned hour doesn't match, it is in the gap: return the instant one hour later than the gap start.
  - Do all calendar arithmetic with `Date.UTC` on wall components, never with local-time methods.
- [ ] **Step 4: Run** the full verification.
- [ ] **Step 5: Commit** with the message `feat(shared): DST-safe time-zone helpers for free times`.

---

### Task 2: Server: free times on posts, Board filters, Discord "When"

**Files:**
- Modify:
  - `server/prisma/schema.prisma`: `Post.freeTimes Int[] @default([])` and `Post.freeTimesZone String?`. New migration `*_post_free_times`.
  - `server/src/posts/routes.ts`:
    - Add `freeTimesSchema` and `freeTimesZoneSchema`.
    - `createPostBody` drops `scheduledAt` and adds `freeTimes` (default `[]`) and `freeTimesZone` (nullable, optional).
    - `editPostBody` follows, since it derives from `createPostBody`.
    - `boardQuery` adds `freeAt: z.coerce.date().optional()`.
    - A `.superRefine` gives 400 `VALIDATION` for a non-empty `freeTimes` with no zone, or an invalid zone (`isValidTimeZone`).
  - `server/src/posts/service.ts`:
    - `CreatePostInput` and `EditPostInput` drop `scheduledAt` and add `freeTimes` and `freeTimesZone`.
    - `createPost` sets `scheduledAt: null`, `expiresAt: postExpiresAt(null, now)`, sorted unique `freeTimes`, and the zone, or null when `freeTimes` is empty.
    - `editPost` removes all schedule and expiry-change logic. It updates `freeTimes`/`freeTimesZone` when sent, and never touches `scheduledAt` or `expiresAt` (Review Focus 3).
    - `listBoard` gets `freeAt`, applied as an id prefilter with `$queryRaw`:

      ```sql
      SELECT id FROM "Post"
      WHERE "freeTimesZone" IS NOT NULL
        AND ((EXTRACT(DOW FROM ($1::timestamptz AT TIME ZONE "freeTimesZone")) * 24
             + EXTRACT(HOUR FROM ($1::timestamptz AT TIME ZONE "freeTimesZone")))::int) = ANY("freeTimes")
      ```

      It is then combined as `id: { in: ids }` with the existing where clause.
  - `server/src/posts/serialize.ts`: the summary and detail DTOs add `freeTimes: number[]` and `freeTimesZone: string | null`.
  - `shared/src/types.ts`: add the same two fields to `PostSummaryDTO`.
  - `server/src/discord/messages.ts`: the "When" field shows `discordTime(scheduledAt)` when finalized. Otherwise it shows "Not set yet — see free times on the post" when `freeTimes` is non-empty, else "Flexible".
  - Web compile fixes only: `web/src/api/postHooks.ts` `CreatePostInput` uses `freeTimes` and `freeTimesZone` instead of `scheduledAt`. Keep `NewPostPage` compiling with a minimal change (send `freeTimes: []`, `freeTimesZone: null`). Task 4 builds the real form.
- Test: `server/test/posts.create.test.ts`, `posts.edit.test.ts`, `posts.board.test.ts`, `discord.messages.test.ts`, plus rewriting the existing tests that create posts with `scheduledAt`. Seed finalized posts through `makePost` with `scheduledAt` set directly, which is what finalized means now.

**Interfaces:**
- Consumes: `isValidTimeZone` (Task 1).
- Produces: request bodies with `{ freeTimes: number[]; freeTimesZone: string | null }`, the DTO fields, the Board query param `freeAt` (ISO), and `BoardFilter.freeAt?: Date`.

- [ ] **Step 1: Write the failing tests:**
  - Create with `freeTimes [68, 20, 68]` and zone NY stores `[20, 68]` and the zone, with `scheduledAt` null and `expiresAt` = created + 7 days.
  - Create with `freeTimes: []` stores the zone as null.
  - Validation, each a 400: `freeTimes [168]`, `[-1]`, `[1.5]`, 169 entries, non-empty with no zone, zone 'Mars/Base'.
  - `scheduledAt` in the create body is ignored: the post is created unfinalized.
  - Editing a finalized post's note or `freeTimes` leaves `scheduledAt` and `expiresAt` byte-equal (Review Focus 3).
  - Board `freeAt`:
    - A NY post with `freeTimes [68]` matches `freeAt=2026-11-11T01:00:00Z` (Tue 5pm LA = Tue 8pm NY).
    - It does not match `freeAt=2026-11-11T04:00:00Z` (Tue 8pm LA).
    - A post with no zone never matches (Review Focus 2 and 5).
    - `freeAt` combines with `type`.
  - Board `flexible=1` still returns only posts with `scheduledAt` null.
  - Discord message "When":
    - finalized: a `<t:` timestamp
    - grid, not finalized: "Not set yet — see free times on the post"
    - empty grid: "Flexible"
- [ ] **Step 2: Run** `npm test -w server -- posts discord.messages`. Expect FAIL.
- [ ] **Step 3: Implement** the schema, migration, routes, service, serializer and message changes above.
- [ ] **Step 4: Run** the full verification.
- [ ] **Step 5: Commit** with the message `feat(server): post free times with poster time zone and Free-at board filter`.

---

### Task 3: Server: finalize the time and notify the party

**Files:**
- Modify:
  - `server/src/posts/service.ts`: `finalizePostTime`.
  - `server/src/posts/routes.ts`: `PUT /posts/:id/final-time` with body `{ scheduledAt: z.string().datetime() }`, returning a PostDetailDTO and emitting `post.finalized`.
  - `server/src/events.ts`: `| { type: 'post.finalized'; postId: string; actorUserId: string }`.
  - `server/src/notifications/dispatcher.ts`: handle `post.finalized`. Add `'time_set'` to `NotificationKind`, and update the schema comment listing kinds.
  - `server/src/discord/messages.ts`: `buildTimeSetPing`.
- Test: `server/test/posts.finalize.test.ts` (new) and `server/test/dispatcher.test.ts`.

**Interfaces:**
- Produces:
  - `finalizePostTime(prisma, viewer: Viewer, id: string, scheduledAt: Date, now: Date): Promise<PostRow>`. It locks the post with `loadPostForUpdate`, applies the Finalize rules from Global Constraints, then sets `scheduledAt` and `expiresAt = postExpiresAt(scheduledAt, now)`. Status is unchanged.
  - `buildTimeSetPing(args: { recipientDiscordId: string; posterIgn: string; post: PostSummaryDTO; scheduledAt: string; webOrigin: string }): WebhookPayload`.
    - Content: `<@id> <posterIgn> set the time for <bosses>: <t:UNIX:F> → <link>`. The names are neutralized.
    - `allowed_mentions: { parse: [], users: [id] }`.
  - **Dispatcher on `post.finalized`:** for each PostMember with role `member`, a non-null `characterId`, and a `userId` that is not the poster:
    - `notify(userId, actorUserId, 'time_set', '<poster IGN> set the time for <bosses>', '/posts/<id>')`
    - `ping(member character's guildId, userId, actorUserId, 'post.finalized', build)`
    - It reuses the existing ping skip rules: inactive guild, no webhook, no guild, the actor.
  - **Ruling:** the in-app text carries no clock time. The bell shows server-written text, which can't be localized per viewer. The linked post shows the time in the viewer's zone, and the Discord ping's `<t:…:F>` localizes itself.

- [ ] **Step 1: Write the failing tests** in `posts.finalize.test.ts`:
  - The poster finalizes a recruiting post 2 days ahead: 200, `scheduledAt` set, `expiresAt = scheduledAt + SCHEDULED_GRACE_MS`, and an `post.finalized` event recorded with `actorUserId`.
  - A second finalize to another time updates both and emits again (Review Focus 4).
  - A non-poster gets 403 `NOT_OWNER`.
  - An LFP post gets 409 `WRONG_POST_TYPE`.
  - A closed, deleted or expired post gets 409 `POST_CLOSED`.
  - A time 10 minutes in the past, or 31 days ahead, gets 400 `VALIDATION`.
  - A full post stays `full` after finalizing.
  - In `dispatcher.test.ts`, `post.finalized` on a post with poster P and members A and B (B in a guild with a webhook):
    - A and B each get a `time_set` notification and P gets none;
    - one delivery goes to B's guild, mentioning B and containing `<t:`;
    - a member whose character has no guild gets the notification but no delivery.
- [ ] **Step 2: Run** `npm test -w server -- posts.finalize dispatcher`. Expect FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run** the full verification.
- [ ] **Step 5: Commit** with the message `feat(server): finalize a recruiting post's time and notify the party`.

---

### Task 4: Web: free-time grid on the post form

**Files:**
- Create:
  - `web/src/components/post/FreeTimeGrid.tsx` and `FreeTimeGrid.css`, restored from `git show 7a73ac3:web/src/components/PlayTimeGrid.tsx` and `…/PlayTimeGrid.css` and adapted.
- Modify:
  - `web/src/pages/NewPostPage.tsx`: remove the datetime input, the Flexible checkbox, their validation and the `scheduledAt` diff logic. Add the grid under the label "When you're free" with the hint "Leave empty if you're flexible".
    - Create sends `freeTimes` plus `freeTimesZone`: the browser zone, or null when empty.
    - Edit sends `freeTimes` and the zone only when the grid changed. If the post's stored zone differs from the browser's, the edit form shows the grid converted with `freeSlotsForViewer`, and saving re-stores it in the browser zone.
  - `web/src/api/postHooks.ts`: the edit input type.
- Test: `web/test/newPost.test.tsx` (rewrite the time tests) and a new `web/test/freeTimeGrid.test.tsx`.

**Interfaces:**
- Consumes: `freeSlotsForViewer` and `instantToZoned` (Task 1), and the request fields (Task 2).
- Produces: `FreeTimeGrid` props `{ value: number[] /* hour-of-week in the viewer's zone */; onChange?: (v: number[]) => void; readOnly?: boolean; label: string }`. The grid does **no** zone conversion itself; callers convert. Export `DAY_LABELS` and `hourLabel` from it.
- Browser zone: `Intl.DateTimeFormat().resolvedOptions().timeZone`, read through a small `browserTimeZone()` in `web/src/components/post/time.ts` so tests can stub it.

- [ ] **Step 1: Write the failing tests:**
  - **Grid editing:** clicking the "Tue 8p" cell calls `onChange([68])`. Enter on a focused cell toggles it. Read-only mode renders `aria-selected` cells with no buttons.
  - **Create sends the grid:** the new-post form has no date input and no "Flexible" checkbox. Selecting Tue 8p and Sat 2p, then submitting, POSTs `freeTimes: [68, 158]` and `freeTimesZone` equal to the stubbed browser zone.
  - **Empty grid:** submitting with nothing selected POSTs `freeTimes: []` and `freeTimesZone: null`.
  - **Edit:** editing a post with `freeTimes [68]` in the same zone shows Tue 8p selected. Changing only the note PATCHes without `freeTimes`.
- [ ] **Step 2: Run** `npm test -w web -- newPost freeTimeGrid`. Expect FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run** the full verification.
- [ ] **Step 5: Commit** with the message `feat(web): free-time grid replaces the post date picker`.

---

### Task 5: Web: showing free times, and the Finalize popup

**Files:**
- Create: `web/src/components/post/FinalizeTimeDialog.tsx`.
- Modify:
  - `web/src/components/post/time.ts`: `whenLabel(post)` returns:
    - `formatWhen(scheduledAt)` when finalized;
    - else "Free times" when `freeTimes` is non-empty;
    - else "Flexible".
  - Use `whenLabel` in `PostRow.tsx`, `PostCard.tsx`, `PostPreview.tsx`, `MyPartiesPage.tsx` and `PostDetailPage.tsx`.
  - `web/src/pages/PostDetailPage.tsx` and `web/src/components/post/PostPreview.tsx` get a When section:
    - "Final time: <formatWhen>" or "Time not set yet";
    - then a read-only `FreeTimeGrid` of `freeSlotsForViewer(freeTimes, freeTimesZone, browserTimeZone(), new Date())` with the caption "Shown in your time zone (<zone>)", or "Flexible" when empty.
    - In the preview the grid may be collapsed behind a `<details>` (builder's call).
  - `PostDetailPage.tsx`: the poster of a live Recruiting post gets a button reading "Finalize time" (or "Change time" once set) that opens the dialog.
  - `web/src/api/postHooks.ts`: `useFinalizeTime(postId)` PUTs `/api/posts/:id/final-time` and invalidates `['posts']`.
- Test: `web/test/postDetail.test.tsx`, `web/test/boardPreview.test.tsx`, and a new `web/test/finalizeTime.test.tsx`.

**Interfaces:**
- Consumes: the DTO fields (Task 2), the endpoint (Task 3), `FreeTimeGrid` and `browserTimeZone` (Task 4).
- Produces: `FinalizeTimeDialog` props `{ post: PostDetailDTO; onClose: () => void }`.
  - It's a native `<dialog>` with `showModal`, using `aria-modal`.
  - It has a `datetime-local` input prefilled from `scheduledAt` (via `utcIsoToLocalInput`) and Save / Cancel.
  - Save sends `localInputToUtcIso(value)`.
  - Errors show inside the dialog via `friendlyError`.
  - Escape and Cancel close it, and focus returns to the opening button only after the dialog unmounts. This is the same pattern as `MoveWorldDialog`.

- [ ] **Step 1: Write the failing tests:**
  - **Post page labels:** a finalized post shows "Final time: …". An unfinalized post with free times shows "Time not set yet", the read-only grid and the zone caption.
  - **Old posts:** an old post with an empty grid and a null zone shows "Flexible", and nothing crashes (Review Focus 5).
  - **Finalize button visibility:** the poster of a recruiting post sees "Finalize time". After it's set the button says "Change time". Non-posters, and LFP posts, show no button.
  - **Saving:** Save PUTs `{ scheduledAt }` with the UTC ISO of the entered local time, closes the dialog and refetches.
  - **Errors:** a 400 `VALIDATION` keeps the dialog open with the message.
  - **Closing:** Escape closes it without a request, and focus returns to the button after the dialog is gone.
  - **Row labels:** `whenLabel` gives "Free times" for an unfinalized post with a grid, and "Flexible" for an empty one.
- [ ] **Step 2: Run** `npm test -w web -- postDetail boardPreview finalizeTime`. Expect FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run** the full verification.
- [ ] **Step 5: Commit** with the message `feat(web): show free times and finalize a post's time`.

---

### Task 6: Web: Board filters (Not set, Free at) and the bell kind

**Files:**
- Modify:
  - `web/src/pages/BoardPage.tsx`:
    - The When chips become Any / Next 24h / This week / Not set. "Not set" keeps sending `flexible=1`.
    - Add a "Free at" control: a keyboard-accessible menu, or two MenuChips for day and hour, in the viewer's zone, with an "Any time" clear option.
  - `web/src/api/postHooks.ts`: `PostFilters.freeAt?: number` (viewer-local hour-of-week). The query sends `freeAt=nextOccurrence(freeAt, browserTimeZone(), now).toISOString()`.
  - `web/src/components/NotificationBell.tsx`: nothing is needed if it renders the server text generically. Only add handling if the kind affects icons or links.
- Test: `web/test/board.test.tsx` and `web/test/boardList.test.tsx`.

**Interfaces:**
- Consumes: `nextOccurrence` (Task 1), the `freeAt` query (Task 2), `browserTimeZone` (Task 4).

- [ ] **Step 1: Write the failing tests:**
  - **When chips:** they read Any, Next 24h, This week and Not set. Not set requests `flexible=1`.
  - **Free at:** picking Tue and 8p, with the browser zone stubbed to America/New_York and the clock fixed at `2026-11-10T15:00:00Z` (`vi.setSystemTime`), requests `freeAt=2026-11-11T01:00:00.000Z`.
  - **Clearing:** "Any time" removes `freeAt`.
  - **Keyboard:** the control can be opened, moved through and chosen with the keyboard only.
- [ ] **Step 2: Run** `npm test -w web -- board`. Expect FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run** the full verification.
- [ ] **Step 5: Commit** with the message `feat(web): Not set and Free at board filters`.

---

### Task 7: Docs

**Files:**
- Modify: `README.md`.
  - **Making a post:** a post lists the poster's free hours on a weekly grid. An empty grid means Flexible.
  - **Time zones:** each viewer sees the hours in their own zone. The poster's zone is stored, so daylight-saving changes don't shift them. The server's own zone doesn't matter.
  - **Finalize:** the poster of a Recruiting post sets the final time with Finalize time or Change time. Members are notified in the app and by a Discord ping.
  - **Board:** the filters are Next 24h, This week and Not set, plus Free at.
  - **Half-hour zones:** they see whole-hour cells.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Commit** with the message `docs: post free times and finalize`.

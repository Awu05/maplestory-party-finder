# Manual Characters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players add characters Nexon can't find, slim the character down to strength and identity details, make the class list admin-managed, and let manual characters move worlds when Nexon finds them elsewhere.

**Architecture:**
- **Prisma schema:**
  - Character gains `source` (nexon | manual) and a stored `archetype`. `guildId` becomes nullable.
  - The `CharacterBoss` table and the `playTimes` and `note` columns are dropped.
  - A new `JobClass` table drives the class dropdown and archetypes.
- **Stored archetype:** it is written whenever `jobName` changes, and backfilled when the admin adds or changes a class. Serializers and filters read it, so no lookup has to be threaded through the many `toCharacterDTO` call sites.
- **Refresh:** it returns an outcome object instead of a bare character. A new move endpoint performs a confirmed world move.

**Tech Stack:** Fastify 5, Prisma 6 + Postgres 16, zod 4, React 18 + TanStack Query 5, Vitest + Testing Library, plain CSS.

**Spec:** `docs/superpowers/specs/2026-11-10-manual-characters-design.md`

## Global Constraints

- **Migrations:** never run `prisma migrate reset` and never drop the dev database. Create each migration with `npx -w server prisma migrate dev --name <name>`. If Prisma refuses non-interactively because of data loss, use `--create-only`, inspect the SQL, then apply with `npx -w server prisma migrate dev`.
- **Secrets:** never create, modify or delete `.env` or `server/.env`.
- **Docker:** don't run `docker compose up/down`. Postgres is already running via `npm run dev:db`.
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `.superpowers/`.
- **Default image URL:** stored in `imageUrl` as `/default-character.svg`. Discord messages already skip non-http thumbnails.
- **Copy, verbatim:**
  - "Add it manually"
  - "Not your character? Add it manually"
  - "Added manually"
  - "No guild"
  - "Still not found on Nexon"
  - "Couldn't reach Nexon, try again later"
  - "Leave or close your open parties first"
  - "Pick a guild for this character first"
  - "<IGN> was found on <World>. Update your character to it?"
  - buttons "Update" / "Not now"
- **Level range:** 1–300.
- **Class lists:** always sorted alphabetically, case-insensitive (`a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })`).
- **World-move candidates:** only **active** worlds with the **same `worldType`** as the character's current world, excluding its current world.
- **Live party:** a PostMember of a post with `deletedAt` null, status `open` or `full`, and `expiresAt > now`.
- **Phones and keyboard:** pages work at 375px wide, and every new control is keyboard-reachable with visible focus.
- **Verification before each commit:** `npm test` (shared, server, web) passes, `npx -w server tsc --noEmit` and `npx -w web tsc --noEmit` are clean, and `npm run build -w web` succeeds.

## Review Focus

1. **Name collisions:** a manual IGN differing only in case or whitespace from an existing character on that world gets a 409 `ALREADY_CLAIMED`, not a second row. Test in Task 3.
2. **Removed class:** after the admin removes a class, editing a manual character that uses it must still work. The edit dropdown shows the current class, and PATCH with the unchanged `jobName` succeeds. Tests in Tasks 3 and 5.
3. **Guildless characters:**
   - Posting or requesting to join with one gets 400 `NO_GUILD` ("Pick a guild for this character first"), shown as friendly text in the UI. Tests in Tasks 3 and 5.
   - The public Characters list still shows them (the guild filter excludes them) and the card says "No guild". Tests in Tasks 3 and 5.
4. **Daily sync:** it must never mark a manual character stale or touch it. Test in Task 3.
5. **Same world wins:** a manual character whose refresh finds a match on its own world AND on another world upgrades in place (outcome `synced`) and does not offer a move. Test in Task 4.

---

### Task 1: Remove bosses, play times and note from characters

**Files:**
- Modify:
  - `server/prisma/schema.prisma`: drop `CharacterBoss` and its enum if unused elsewhere (keep `ExperienceLevel` only if posts use it; they don't), plus `Character.note`, `Character.playTimes` and the `bosses` relation.
  - New migration `server/prisma/migrations/*_slim_character/`.
  - Server: `server/src/characters/{routes,service,serialize}.ts`, `server/src/catalog/routes.ts` (the in-use checks at ~278 and ~309 drop the `characterBoss` counts), `server/test/helpers.ts`.
  - Shared: `shared/src/types.ts` (remove `note`, `playTimes`, `bosses` from `CharacterDTO`; remove `ExperienceLevel` and `EXPERIENCE_LABELS`, plus their exports in `shared/src/index.ts`, if nothing else uses them).
  - Web: `web/src/api/hooks.ts` (`CreateCharacterInput` and `UpdateCharacterInput` lose the 3 fields), `web/src/pages/CharacterFormPage.tsx` (`DetailsForm` becomes CP, guild and screenshot only), `web/src/components/card/CharacterCard.tsx` (remove the `bossContext` prop and badges), `web/src/components/card/CardDetailModal.tsx` (remove the Bosses, Play times and Note sections), `web/src/components/post/{LineupView,PostCard,ViewerActions}.tsx` (stop passing `bossContext`), `web/src/pages/admin/TiersAdmin.tsx` (sample DTO).
  - Remove the now-unused card badge CSS rules.
- Delete: `web/src/components/BossExperiencePicker.tsx`, `web/src/components/PlayTimeGrid.tsx`.
- Test: update the existing server tests `characters.create.test.ts`, `characters.manage.test.ts`, `catalog.test.ts` and the web tests `card.test.tsx`, `characterPages.test.tsx`, `characterHooks.test.tsx` and any fixture building a `CharacterDTO`.

**Interfaces:**
- Produces:
  - `CreateCharacterInput` = `{ ign; nexonWorldId; combatPower; guildId }`
  - `UpdateCharacterInput` = `Partial<{ combatPower; guildId }>` (extended in Task 3)
  - `CharacterDTO` without `note`, `playTimes` or `bosses`
  - `CharacterCard` props = `{ character, tiers, onOpen? }`

- [ ] **Step 1: Write the failing tests**
  - In `characters.create.test.ts`, a create body containing only `{ ign, nexonWorldId, combatPower, guildId }` returns 201, and the DTO has no `note`, `playTimes` or `bosses` keys (`expect(body).not.toHaveProperty('bosses')`, and the same for the other two).
  - In `characterPages.test.tsx`, the add form after picking a preview shows Combat power, Guild and Scouter screenshot, with no "Bosses", "Play times" or "Note" text (`queryByText(...)` is null).
  - In `card.test.tsx`, the detail modal has no "Bosses", "Play times" or "Note" headings.
- [ ] **Step 2: Run and confirm they fail.** Run `npm test -w server -- characters.create` and `npm test -w web -- characterPages card`. Expect failures on the extra fields and labels.
- [ ] **Step 3: Change the schema, create the `slim_character` migration, then update server, shared and web.**
  - Delete the obsolete tests that asserted boss, play-time or note behavior, such as duplicate `bossDifficultyId` and the `playTimes` validation.
  - zod: strip unknown keys as today, so old clients sending the fields don't error. `z.object` already strips.
- [ ] **Step 4: Run the full verification** from Global Constraints. Everything passes.
- [ ] **Step 5: Commit** with the message `feat: remove bosses, play times and note from characters`.

---

### Task 2: Admin-managed class list and stored archetype

**Files:**
- Modify:
  - `server/prisma/schema.prisma`:
    - `enum Archetype { warrior magician bowman thief pirate xenon unknown }`
    - `model JobClass { id Int @id @default(autoincrement()); name String; nameLower String @unique; archetype Archetype }`
    - `Character.archetype Archetype @default(unknown)`
  - New migration `*_job_classes`.
  - `shared/src/archetype.ts`: export `KNOWN_CLASSES: { name: string; archetype: Exclude<Archetype, 'unknown'> }[]` built from `TABLE`, and keep `classToArchetype`.
  - `shared/src/types.ts`: `JobClassDTO = { id: number; name: string; archetype: Exclude<Archetype,'unknown'> }`, and `CharacterDTO.archetype: Archetype`.
  - `server/prisma/seed.ts`:
    - Upsert every `KNOWN_CLASSES` entry by `nameLower`. Create only; don't overwrite an admin's archetype change.
    - Then backfill: for each JobClass, `character.updateMany({ where: { jobName: { equals: name, mode: 'insensitive' }, archetype: 'unknown' }, data: { archetype } })`.
  - Create `server/src/classes/archetype.ts` with `resolveArchetype(db, jobName): Promise<Archetype>`. It looks up the JobClass by `nameLower`, then falls back to `classToArchetype`.
  - Use it everywhere `jobName` is written: `createCharacter` and `syncCharacterFromNexon` in `server/src/characters/service.ts`.
  - `server/src/characters/serialize.ts`: DTO `archetype: row.archetype`.
  - `listCharacters`: filter with `where.archetype` instead of the in-memory `classToArchetype` filter.
  - `server/src/catalog/routes.ts`:
    - `GET /classes`
    - `POST /admin/classes` with body `{ name: string (trim, 1..40), archetype }`, returning 201 JobClassDTO, or 409 `DUPLICATE` "That class already exists"
    - `PATCH /admin/classes/:id` with body `{ archetype }`
    - `DELETE /admin/classes/:id`, returning 204, or 404
    - POST and PATCH also run `character.updateMany` (case-insensitive `jobName` match) to set the new archetype.
  - `server/test/helpers.ts`: `makeCharacter` defaults `archetype` to `classToArchetype(jobName)`. Add `makeJobClass(name, archetype)`.
  - Web:
    - `web/src/api/hooks.ts`: `useClasses()` with queryKey `['classes']`, `useCreateClass()`, `useUpdateClass()`, `useDeleteClass()`. Admin mutations also invalidate `['characters']` and `['posts']`.
    - `web/src/components/card/CharacterCard.tsx`: use `c.archetype`.
    - `web/src/pages/admin/AdminLayout.tsx`: a nav link "Classes".
    - `web/src/App.tsx`: the route `admin/classes`.
- Create: `web/src/pages/admin/ClassesAdmin.tsx`.
- Test: `server/test/classes.test.ts` (new); extend the table-driven 401/403 test in `server/test/catalog.test.ts` with the 3 admin class routes; `web/test/admin.test.tsx`.

**Interfaces:**
- Produces:
  - `resolveArchetype(db: PrismaClient | Prisma.TransactionClient, jobName: string): Promise<Archetype>`
  - `JobClassDTO`
  - `useClasses(): UseQueryResult<JobClassDTO[]>`
  - `CharacterDTO.archetype`

- [ ] **Step 1: Write the failing server tests** in `classes.test.ts`:
  - `GET /api/classes` returns the classes sorted alphabetically, case-insensitive. Seed "zero", "Adele" and "Bishop", and expect `['Adele','Bishop','zero']`.
  - The admin POST creates a class. A duplicate in different case ("adele") returns 409.
  - The admin POST of "NewClass"/thief sets `archetype: 'thief'` on an existing character whose `jobName` is "newclass". The DTO from `GET /api/characters/:id` has `archetype: 'thief'`.
  - The admin PATCH changes the archetype and the character's archetype follows.
  - The admin DELETE removes the class (204). A character using it keeps its archetype.
  - `createCharacter` stores the archetype from JobClass, and that wins over the shared list. Seed "Hero" as magician and expect `'magician'`.
  - The `?archetype=thief` list filter uses the stored column.
  - In `catalog.test.ts`, the 3 routes are added to the 401/403 table.
- [ ] **Step 2: Run** `npm test -w server -- classes catalog`. Expect FAIL (routes missing).
- [ ] **Step 3: Implement the schema, migration, seed, routes and `resolveArchetype`.** The seed is idempotent; re-running it creates no duplicates.
- [ ] **Step 4: Write the failing web test** in `admin.test.tsx`. The Classes admin page lists classes alphabetically, adds a class (name plus archetype select), changes an archetype through the row's select, and removes one with a confirm. Each action hits the right endpoint. Non-admins can't see it, following the existing AdminLayout guard pattern.
- [ ] **Step 5: Implement `ClassesAdmin.tsx`**, styled like `BossesAdmin.tsx` and `WorldsAdmin.tsx`, plus the hooks. Update the card to read `c.archetype` and fix the fixtures (`archetype` in every `CharacterDTO` fixture).
- [ ] **Step 6: Run the full verification.** Everything passes.
- [ ] **Step 7: Commit** with the message `feat: admin-managed class list with stored archetype`.

---

### Task 3: Manual characters on the server (create, edit, nullable guild, sync skip)

**Files:**
- Modify:
  - `server/prisma/schema.prisma`: `enum CharacterSource { nexon manual }`, `Character.source CharacterSource @default(nexon)`, `Character.guildId String?` with `guild Guild?`. New migration `*_manual_characters`.
  - `shared/src/types.ts`: `CharacterDTO.manual: boolean` and `CharacterDTO.guild: { id; name; iconUrl } | null`.
  - `server/src/characters/serialize.ts`: `manual: row.source === 'manual'`, and a nullable guild.
  - `server/src/posts/snapshot.ts`: `guildName: row.guild?.name ?? 'No guild'`.
  - `server/src/characters/service.ts`:
    - `createManualCharacter`.
    - `updateCharacter` accepts `jobName` and `level`.
    - `listCharacters`: the public filter becomes `OR: [{ guildId: null }, { guild: { active: true } }]`, and the guild filter still uses `guildId`.
  - `server/src/characters/routes.ts`: `POST /characters/manual`, and the PATCH body gains `jobName` and `level`.
  - `server/src/posts/service.ts`: `getPostingCharacter` throws 400 `NO_GUILD` "Pick a guild for this character first" when `guildId` is null, before the guild-active check.
  - `server/src/requests/service.ts`: `createJoinRequest` throws the same `NO_GUILD` 400 after the owner check.
  - `server/src/notifications/dispatcher.ts`: when `ch.guildId` is null, the ping is skipped.
  - `server/src/jobs/dailySync.ts`: the query adds `source: 'nexon'`.
  - Fix every other TypeScript break from the nullable guild, such as admin moderation serializers.
- Test: `server/test/characters.manual.test.ts` (new); extend `dailySync.test.ts`, `posts.create.test.ts`, `requests.join.test.ts` (or whichever file holds join-request tests) and `dispatcher.test.ts`.

**Interfaces:**
- Consumes: `resolveArchetype` (Task 2).
- Produces:
  - `createManualCharacter(prisma, ownerId, input: ManualCharacterInput): Promise<CharacterRow>`, where `ManualCharacterInput = { ign: string; worldId: number; jobName: string; level: number; combatPower: number; guildId: string }`.
  - `POST /api/characters/manual`, with a zod body: ign trim 1..32, worldId int, jobName trim min 1, level int 1..300, combatPower as in create, guildId min 1. It returns 201 CharacterDTO.
  - `UpdateCharacterInput` gains `jobName?: string; level?: number`.
  - DTO `manual` and nullable `guild`.
  - The error code `NO_GUILD`.

- [ ] **Step 1: Write the failing tests** in `characters.manual.test.ts`:
  - A manual create stores `source manual`, `imageUrl '/default-character.svg'`, the canonical class name from JobClass (input "hero" becomes "Hero"), and the archetype. It returns `manual: true`. FakeNexon records **no** calls.
  - Validation:
    - an unknown class gives 400 `UNKNOWN_CLASS` "Pick a class from the list"
    - an inactive world gives 400 `WORLD_INACTIVE`
    - an inactive guild gives 400 `GUILD_INACTIVE`
    - level 0 or 301 gives 400
  - Name collisions: "  SunOfSinz " on a world that already has "sunofsinz" (synced or manual) gives 409 `ALREADY_CLAIMED`.
  - Class and level edits:
    - PATCH `{ jobName: 'Bishop', level: 250 }` on a manual character updates both and the archetype.
    - The same PATCH on a nexon character gives 400 `NOT_MANUAL` "Only manually added characters can change class or level".
  - Removed class: delete the JobClass "Hero", then a PATCH `{ jobName: 'Hero', combatPower: 5 }` on a manual Hero character succeeds, because an unchanged `jobName` skips the list check.
  - Guildless characters:
    - A character with `guildId` null is in the public `GET /api/characters` with `guild: null`.
    - It is excluded when `?guildId=` is set.
  - In `dailySync.test.ts`, a manual character is not passed to Nexon, and its `syncStatus` and `lastSyncedAt` are unchanged after a run.
  - `posts.create` with a guildless character gives 400 `NO_GUILD`.
  - A join request with a guildless character gives 400 `NO_GUILD`.
  - In the dispatcher, a `request.created` invite whose character has no guild enqueues no delivery and doesn't throw.
- [ ] **Step 2: Run** `npm test -w server -- characters.manual dailySync posts.create dispatcher`. Expect FAIL.
- [ ] **Step 3: Implement the schema, migration and services listed above.** The uniqueness rule relies on the existing `@@unique([ignLower, worldId])` with `ignLower = ign.trim().toLowerCase()`. Map P2002 to 409 as `createCharacter` does.
- [ ] **Step 4: Run the full verification.** Web type errors from the nullable guild or the new DTO fields are fixed minimally here: render `c.guild?.name ?? 'No guild'` and add `manual: false` to the fixtures. The UI work is Task 5.
- [ ] **Step 5: Commit** with the message `feat(server): manual characters, nullable guild, sync skip`.

---

### Task 4: Refresh outcomes and world move (server)

**Files:**
- Modify:
  - `shared/src/types.ts`:
    - `RefreshOutcome = 'synced' | 'stale' | 'not_found' | 'unavailable' | 'found_elsewhere'`
    - `WorldCandidateDTO = { worldId: number; worldName: string; level: number; jobName: string; imageUrl: string }`
    - `RefreshResultDTO = { outcome: RefreshOutcome; character: CharacterDTO; candidates: WorldCandidateDTO[] }`
  - `server/src/characters/service.ts`:
    - `syncCharacterFromNexon` keeps its `'ok' | 'stale'` contract for nexon rows (used by daily sync).
    - A new `refreshCharacter(prisma, nexon, id): Promise<{ outcome: RefreshOutcome; candidates: WorldCandidateDTO[] }>`.
    - A new `moveCharacterWorld`.
  - `server/src/characters/routes.ts`: `POST /characters/:id/refresh` returns `RefreshResultDTO` (a **breaking change**: the web is updated in Task 6). Add `POST /characters/:id/move`.
- Test: `server/test/characters.refresh.test.ts` (new); update the existing refresh tests in `characters.manage.test.ts` to the new response shape.

**Interfaces:**
- Consumes:
  - `resolveArchetype` (Task 2).
  - The `source` and nullable guild (Task 3).
  - `claimRefresh` (existing): the refresh still claims the cooldown first, for all outcomes.
- Produces:
  - `refreshCharacter` behavior:
    - **nexon row:** delegate to `syncCharacterFromNexon` (fresh) and map ok to `synced` and stale to `stale`. Candidates are `[]`.
    - **manual row:** call `nexon.findByName(ign, { fresh: true })`.
      - `NexonUnavailableError` gives `unavailable`, with no write.
      - A match on its own world sets `source nexon`, the real level, `jobName`, `imageUrl` and archetype, `syncStatus ok` and `lastSyncedAt` now, giving `synced`.
      - Else, matches on candidate worlds (see Global Constraints) give `found_elsewhere`, with candidates sorted by world name and no write.
      - Else `not_found`, with no write and `syncStatus` untouched.
  - `moveCharacterWorld(prisma, nexon, userId, id, input: { worldId: number; guildId: string | null }): Promise<CharacterRow>`, used by `POST /characters/:id/move` with body `{ worldId: number, guildId: string | null }`, returning a CharacterDTO. Rules, in order:
    1. Owner only (403).
    2. `source` must be manual: 400 `NOT_MANUAL`.
    3. The target world must be a candidate: 400 `WRONG_WORLD` "That world isn't an option for this character".
    4. The guild, when non-null, must be active: 400 `GUILD_INACTIVE`.
    5. The Nexon re-check (fresh) must find the IGN on the target world. Unavailable gives 502 `NEXON_UNAVAILABLE`; missing gives 404 `CHARACTER_NOT_FOUND`.
    6. Then, in one transaction, check for a live party or pending request (as poster member or member, or any `Request` with `characterId` and status pending). Either gives 409 `IN_PARTY` "Leave or close your open parties first".
    7. Then update `worldId`, `guildId` (the given value, or null), `source nexon`, and level, `jobName`, `imageUrl`, archetype, `syncStatus ok`, `lastSyncedAt`.
    8. P2002 gives 409 `ALREADY_CLAIMED`.
  - The move does not claim the refresh cooldown (*my call*: it follows a refresh that already did).

- [ ] **Step 1: Write the failing tests** in `characters.refresh.test.ts`, using FakeNexon:
  - A nexon character found returns `synced`. Not found, or Nexon unavailable, returns `stale` and the row is stale (today's behavior, new shape).
  - Manual, found on the same world: `synced`, `manual` false, real level, class and image.
  - Manual, found on its own world AND another heroic world: `synced`, candidates `[]` (Review Focus 5).
  - Manual on heroic "Challenger", found on heroic "Kronos" and interactive "Solis": `found_elsewhere` with only Kronos. An inactive heroic world match is also excluded.
  - Manual not found: `not_found`, and `syncStatus` stays `ok`.
  - Manual and Nexon unavailable: `unavailable`, row unchanged.
  - A second refresh within 10 minutes gives 429 `TOO_SOON` for a manual character too.
  - A move to the candidate with `guildId: null` gives 200: `world` Kronos, `guild` null, `manual` false.
  - A move with a new active guild sets it.
  - A move to a non-candidate world gives 400 `WRONG_WORLD`.
  - A move while the character is a member of an open post gives 409 `IN_PARTY`. The same holds with a pending join request. A closed or expired post doesn't block.
  - A move when another character with that IGN exists on Kronos gives 409 `ALREADY_CLAIMED`.
  - A move of a nexon character gives 400 `NOT_MANUAL`.
  - A move when Nexon no longer lists it there gives 404 `CHARACTER_NOT_FOUND`.
- [ ] **Step 2: Run** `npm test -w server -- characters.refresh characters.manage`. Expect FAIL.
- [ ] **Step 3: Implement `refreshCharacter`, `moveCharacterWorld` and the routes.**
- [ ] **Step 4: Run the full verification.** The web `useRefreshCharacter` type gets updated to `RefreshResultDTO`, with a minimal `onSuccess` mapping so the tsc and web tests pass; the full UI comes in Task 6.
- [ ] **Step 5: Commit** with the message `feat(server): refresh outcomes and world move for manual characters`.

---

### Task 5: Web: manual add path, manual edit, card labels

**Files:**
- Create:
  - `web/public/default-character.svg`: a neutral silhouette sized for the card art area, roughly 96×96 viewBox, using muted tones that read on navy.
  - `web/src/components/character/ManualFields.tsx`: world select, class select and level input, plus an IGN input when adding.
- Modify:
  - `web/src/api/hooks.ts`: `useCreateManualCharacter()` POSTs `/api/characters/manual`, and `UpdateCharacterInput` gains `jobName` and `level`.
  - `web/src/pages/CharacterFormPage.tsx`:
    - **AddCharacter:** an "Add it manually" button after "No character found with that name." or after a lookup error, and "Not your character? Add it manually" under non-empty previews.
    - **Manual add form:** clicking reveals ManualFields, with the IGN prefilled from the search, followed by the DetailsForm (CP, guild, screenshot) and Save.
    - **EditCharacter:** for `manual` characters, show class and level above CP. The class options are `useClasses()` plus the character's current `jobName` if it's missing from the list (Review Focus 2).
    - **Character pickers:** show "Pick a guild for this character first" for a guildless character.
  - `web/src/components/card/CharacterCard.tsx`: show "Added manually" (small, muted, inside the card; the builder picks the spot) when `c.manual`, and the guild as `c.guild?.name ?? 'No guild'`. Do the same in `CardDetailModal.tsx`.
- Test: `web/test/characterPages.test.tsx` and `web/test/card.test.tsx`.

**Interfaces:**
- Consumes:
  - `useClasses` (Task 2)
  - `POST /api/characters/manual`, `ManualCharacterInput`, the PATCH `jobName` and `level`, and DTO `manual` and `guild | null` (Task 3)
- Produces:
  - `ManualFields` props: `{ ign?: string; onIgn?: (v: string) => void; worldId: string; onWorld; jobName: string; onJob; level: string; onLevel; classOptions: string[]; worlds: WorldDTO[] }`
  - The builder may reshape these props, but keeps them controlled.

- [ ] **Step 1: Write the failing tests** in `characterPages.test.tsx`:
  - A lookup returning `[]` shows "Add it manually".
  - Clicking it shows World, Class and Level fields, with the IGN prefilled "sunofsinz" and the class options in alphabetical order.
  - Filling them plus CP and guild, then Save, POSTs `/api/characters/manual` with `{ ign, worldId, jobName, level, combatPower, guildId }` and navigates to `/me/characters`.
  - A lookup error (502) also shows "Add it manually".
  - A lookup with results shows "Not your character? Add it manually".
  - Level "0" or empty shows the error "Enter a level from 1 to 300." and doesn't POST.
  - Editing a manual character shows Class and Level, and saving PATCHes them.
  - Editing a nexon character shows no Class or Level fields.
  - Editing a manual character whose class is not in `/api/classes` shows that class selected.
  - In `card.test.tsx`, a manual character shows "Added manually", and a guildless one shows "No guild".
- [ ] **Step 2: Run** `npm test -w web -- characterPages card`. Expect FAIL.
- [ ] **Step 3: Implement it.**
  - The form error copy is "Enter a level from 1 to 300." and "Pick a world." and "Pick a class.".
  - The buttons use the existing `.btn` classes, and the gaps follow the spacing tokens.
- [ ] **Step 4: Run the full verification.** Also check at 375px width that the add page has no horizontal scroll, either by CSS review or by the existing layout tests.
- [ ] **Step 5: Commit** with the message `feat(web): add and edit manual characters`.

---

### Task 6: Web: refresh outcomes and the found-on-another-world popup

**Files:**
- Create: `web/src/components/character/MoveWorldDialog.tsx`.
- Modify:
  - `web/src/api/hooks.ts`: `useRefreshCharacter` returns `RefreshResultDTO`, and `useMoveCharacter(id)` POSTs `/api/characters/:id/move` and invalidates characters and posts.
  - `web/src/pages/MyCharactersPage.tsx`: map the outcomes to messages, and open the dialog on `found_elsewhere`.
- Test: `web/test/characterPages.test.tsx` (or a new `web/test/moveWorld.test.tsx`).

**Interfaces:**
- Consumes: `RefreshResultDTO` and `POST /characters/:id/move` (Task 4).
- Produces: `MoveWorldDialog` props `{ character: CharacterDTO; candidates: WorldCandidateDTO[]; onClose: () => void; onMoved: (c: CharacterDTO) => void }`.

- [ ] **Step 1: Write the failing tests:**
  - Refresh messages:
    - `synced` shows "Synced from Nexon"
    - `stale` shows "Couldn't reach Nexon — showing last known data" (existing copy)
    - `not_found` shows "Still not found on Nexon"
    - `unavailable` shows "Couldn't reach Nexon, try again later"
  - `found_elsewhere` with one candidate opens a dialog (`role="dialog"`, `aria-modal="true"`) reading "SunOfSinz was found on Kronos. Update your character to it?" It has an optional guild select defaulting to "No guild", plus Update and Not now.
  - With two candidates the dialog shows a world radio group, and Update is disabled until one is picked.
  - Update POSTs `/move` with `{ worldId, guildId: null }` (or the picked guild), closes and shows "Moved to Kronos".
  - A 409 `IN_PARTY` keeps the dialog open and shows "Leave or close your open parties first".
  - Not now and Escape close it without a request, returning focus to the Refresh button.
- [ ] **Step 2: Run** `npm test -w web -- characterPages moveWorld`. Expect FAIL.
- [ ] **Step 3: Implement it.**
  - The dialog follows the focus and Escape handling pattern of `CardDetailModal.tsx`: focus moves to the first control on open.
  - The guild options are active guilds, sorted by name.
- [ ] **Step 4: Run the full verification.**
- [ ] **Step 5: Commit** with the message `feat(web): refresh outcomes and move-world dialog`.

---

### Task 7: Docs

**Files:**
- Modify:
  - `README.md`: add a short "Characters Nexon can't find" note (manual add, refresh upgrade and world move), and mention Admin -> Classes.
  - `docs/superpowers/plans/2026-11-09-ui-midnight-followups.md`: mark the manual-character queued item done.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Commit** with the message `docs: manual characters and class admin`.

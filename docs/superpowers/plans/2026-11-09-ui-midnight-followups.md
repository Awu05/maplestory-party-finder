# Midnight UI redesign follow-ups

## Queued features (user-approved, build next)
- DONE (follow-up session + Profile popup): DONE (display-name): account-level editable Display name — User.displayName nullable; Profile page from header avatar/name; cards/modal/lineups/Discord messages show displayName ?? username; modal also shows real @username small; login keeps displayName; pings unaffected; admin search matches both; update spec "can't be edited" line.
- DONE (feat/manual-characters): QUEUED (user request): manual character fallback when Nexon lookup finds nothing (e.g. Challenger World) — enter name/world/class/level manually; skipped by daily sync; editable. Image question pending with user (upload vs class placeholder).
- DONE (feat/manual-characters): QUEUED spec detail (user answered): manual character fallback uses ONE default character image (card frame still class-colored); user enters name, world, class, level when lookup finds nothing or Nexon unreachable; "added manually" note on card; skipped by daily sync; editable class/level; "Refresh from Nexon" upgrades it to synced if Nexon later finds it.

## Deferred review findings
- Task 1: minor (deferred): contrast test hard-codes button text instead of reading --accent-text; danger-hover text untested
- Task 2: minor (deferred): phone visually-hidden lacks legacy clip/margin; bell panel fixed top assumes single-row header
- Task 3: minor (deferred): chips.css comment "regardless of ancestors" inaccurate for transformed ancestors; fixed popup doesn't follow scroll while open
- Task 6: minor (deferred): duplicated test fixtures board/boardList; select missing from effect deps (no eslint)
- Task 7: minor (deferred): preview error test doesn't assert friendly text; no assertion compact omits Remove/Leave or no fetch when unselected; preview flickers between selections (no placeholderData)
- Task 8: minor (deferred): no test for Cancel route, chip selected label, world/archetype chips
- Task 11: minor (deferred): Admin Guilds/logged-in pages not screenshotted (ruling allows)
- Final review deferred (kept): typography scale/h1 consistency; input boundary 3:1 (WCAG 1.4.11) lighter border; leftover ad-hoc spacing in bell.css/card modal; CharacterForm Cancel untested; NewPost has no Cancel; prettier 80-col reflow churn.

## From deep review #2 (fix/deep-review-2)
- A deep link that fails, is re-linked, and fails again can show the error pane instead of falling back to the first row (reset effect vs. child onUnavailable ordering). Reset `unavailable` during render or only when it differs from `wanted`.
- MenuChip: when options change while open, the active option snaps back to the selected value (loses arrow-key position).
- Selection scroll math ignores the list's 4px padding (no visible effect).
- Gap fix 1 (reopen guard) reads the other party's membership without locking it; a simultaneous join could still let the LFP post reopen (rare, benign).

## From the free-times build (feat/post-free-times)
- Grid touch drag-select on phones not built: `touch-action: none` would block scrolling the grid sideways. Needs a design call (long-press or a paint mode). Taps toggle cells; phone cells are 24px tall.
- Moving a character to another world can still race a join that validated the character before the move's lock. Closing it needs `FOR SHARE` on the character in the join, invite and accept paths.
- The Docker image wasn't rebuilt after the Prisma seed config moved to `server/prisma.config.ts`. Checked by reading only; build and start it once before deploying.
- The `time_set` bell text has no clock time (the bell shows server-written text); the post page and Discord ping show the localized time.

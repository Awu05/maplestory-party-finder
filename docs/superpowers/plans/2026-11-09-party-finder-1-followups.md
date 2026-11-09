# Plan 1 follow-ups (deferred review findings)

Minor findings from Plan 1's task reviews that were deliberately deferred. Consider them while writing Plans 2 and 3.

- Task 1: minor (deferred): config.ts PORT not validated (NaN / empty → 0 disables logger)
- Task 1: minor (deferred): app.ts logger toggled by port!==0 — implicit coupling
- Task 1: minor (deferred): errors.ts err:any; AppError/Zod mapping untested
- Task 1: minor (deferred): index.ts no SIGTERM/startup error handling
- Task 1: minor (deferred): shared exports raw .ts — prod build must bundle (T14 tsup noExternal)
- Task 2: minor (deferred): testDatabaseUrl.ts bare catch hides malformed .env.test
- Task 2: minor (deferred → T14): no `prisma generate` step; fresh clone fails until run manually (npm blocks postinstall). T14 must add `pretest`/build generate + README.
- Task 2: minor (deferred): helpers.ts makeCharacter world.findFirst() lacks orderBy
- Task 3: minor (deferred): playTimes.ts no range guard on day/hour (API must zod-validate)
- Task 3: minor (deferred): rarity/archetype tests could cover mid-tier isTop and every table entry
- Task 3: minor (deferred): shared uses extensionless re-exports — verify server (tsx/tsc NodeNext) imports work when first consumed (T8)
- Task 4: minor (deferred, triage at final): nexon client has no fetch timeout/AbortSignal — hung Nexon stalls create instead of quick 502
- Task 4: minor (deferred): nexon cache never evicts; returns cached array by reference; no in-flight dedupe
- Task 5: minor (deferred, triage at final): callback doesn't handle Discord ?error=access_denied (user cancel → JSON 400); exchangeCode errors → 500
- Task 5: minor (deferred): state compare not timing-safe; failed callback doesn't clear state; no fetch timeout in HttpDiscordOAuth
- Task 5: minor (deferred): requireUser duplicates getViewer lookup; stateless cookie stays valid after logout until expiry
- Task 5: minor (deferred): BAD_STATE test doesn't assert no user created; no missing-code test; index.ts no prisma.$disconnect
- Task 6: minor (deferred): admin 401/403 tested on one route only; table-driven test over all admin routes would lock it in
- Task 6: minor (deferred): boss DELETE/PATCH count-then-delete race → P2003 500 instead of 409 IN_USE
- Task 6: minor (deferred): tiers allow duplicate minCp; iconUrl/imageUrl any scheme; PATCH unknown guild w/ bad worldIds → 400 not 404
- Task 7: minor (deferred): /uploads lacks X-Content-Type-Options: nosniff; NO_FILE test doesn't assert 400; no near-miss sniff negatives; test temp dirs never cleaned
- Task 8: minor (deferred): no test for DTO boss sort order, lookup worldName:null, nonexistent guildId; lookup spreads NexonCharacter fields; experience enum duplicated from shared in zod
- Task 9: minor (deferred, triage at final): DELETE awaits storage.remove without catch → 500 after row deleted; inconsistent with screenshot route
- Task 9: minor (deferred): duplicate @pf/shared imports in service.ts; cpUpdatedAt bumps even if CP unchanged; no test for screenshot rollback path
- Task 10: minor (deferred, triage at final): Layout logout() no error handling; failed /api/auth/me leaves no login button
- Task 10: minor (deferred): no unit tests for api() client (ApiError/204/FormData); setup file is setup.tsx (justified)
- Task 11: minor (deferred): cpUpdatedLabel NaN on bad ISO, untested; formatCp promotion branch untested; Copy button "Copied" never resets, clipboard untested
- Task 11: minor (deferred): light-mode badge hexes not tokens; PlayTimeGrid DST off-by-one across DST boundary; no img onError fallback; no body scroll lock
- Task 11: minor (deferred): .card--rank-high specificity dropped to (0,1,0) — check hover/focus box-shadow overrides in card.css
- Task 12: minor (deferred): useCharacters({mine}) fires when logged out; CP input no MAX_SAFE_INTEGER bound; no touch drag in grid
- Task 12: minor (deferred): test gaps — edit PATCH body playTimes/bosses, multi-world preview, debounce timing, NEXON_UNAVAILABLE mapping, CP validation
- Task 13: minor (deferred): Active-toggle error hidden when create form open (Guilds/Worlds); admin mutations don't invalidate ['characters']
- Task 13: minor (deferred): Worlds/Bosses forms & IN_USE path untested; `u` helper copy-pasted 3x in admin.test.tsx; dead PUT mock; BossEditor doesn't resync from props
- Task 14: minor (deferred): Dockerfile runtime stage lacks tsconfig files (tsx seed may warn); README prod .env note re DATABASE_URL/UPLOAD_DIR override; hardcoded pf:pf db creds in prod compose; full node_modules in image; prisma package.json#prisma deprecation warning (plan-mandated)
- Final fix wave: re-review all 14 ADDRESSED, no new breakage (commits b195116..de93abe). Parked: OAuth callback DB-upsert failure still 500 JSON; World.region stored but not used for per-world Nexon routing.

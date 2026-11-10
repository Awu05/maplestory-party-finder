# Plan 3 follow-ups (deferred review findings)

Minor findings from Plan 3's reviews that were deliberately deferred.

- Task 1: minor (deferred): Notification defaults not asserted; cascade test checks by length not id
- Task 2: minor (deferred): ping content not clipped to 2000 (safe under MAX_POST_BOSSES); clip may split surrogate pairs; thumbnail url unguarded; discordTime NaN on bad ISO; ZWSP-only note; markdown links not neutralized
- Task 3: minor (deferred): lease test timing-based (300ms); no start/stop or true concurrent SKIP LOCKED test; timeout surfaces as DOMException; non-429 body not consumed
- Task 4: minor (deferred): auto-decline re-reads rows per event (bounded); untested skip rules (inactive guild ping, no discordId, self-invite actor); buildTestApp overload return type
- Task 6: minor (deferred): health recentFailures N+1 per guild; test-send not rate-limited; DB insert failure after send → 500; untested unknown-guild 404 / lastSentAt latest
- Task 7: minor (deferred): failed run returns {0,0} (indistinguishable); prune failure loses sync counts; untested crash-safety/top-level error/start-stop paths; non-atomic gate (single instance ok)
- Task 8: minor (deferred, triage at final): reassign emits request.cancelled from findMany ids (use RETURNING); reassign/ban don't lock Character row (TOCTOU with in-flight create); reassign to current owner not rejected; invites keep old createdByUserId (sentInvitesToThis display)
- Task 8: minor (deferred): test gaps (ban lfpPostId/full/other-admin, admin delete events, status=all); admin DELETE tail duplicated; admin q misses deleted-poster posts
- Task 9: minor (deferred): aria-haspopup misuse + Escape doesn't restore focus; markRead errors unhandled; mobile sheet top hardcoded; logged-out test doesn't assert no request
- Task 10: minor (deferred): 60s refetchInterval not asserted; trailing space in pill className; expanded row mobile layout unverified
- Task 11: minor (deferred): CharactersPage inline debounce could use useDebouncedValue; untested posts q / CANNOT_BAN_ADMIN text / Unban; real-timer debounce test; shared isPending disables all ban buttons
- Task 12: minor (deferred): stopped mid-run sync still advances lastRunAt (remaining chars wait up to 24h); README "every character" omits banned skip
- Task 12: minor (deferred): if app.close() throws, drain is skipped (rare)
- Final fix wave: re-review all 8 ADDRESSED, no new breakage (commits 1000d02..9c20e9b). Parked: null-guild poster char ping falls back to post guild; no explicit http:// thumbnail test.

## From the deep review fix branch (fix/deep-review)
- PATCH with `scheduledAt: null` on an already-flexible post still resets expiresAt (acts like Renew via API; web never sends it). Compare against row.scheduledAt to make it a no-op.
- Leaving a party reopens the member's matched LFP post even if that character has since joined another live party.
- web/src/components/card/format.ts still defines its own DAY_MS; use the shared one.

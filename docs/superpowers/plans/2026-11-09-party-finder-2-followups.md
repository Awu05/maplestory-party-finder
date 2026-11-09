# Plan 2 follow-ups (deferred review findings)

Minor findings from Plan 2's reviews that were deliberately deferred. Consider them while building Plan 3.

- Task 1: minor (deferred): helpers snapshot logic duplicated in makePost/addMember; dense poster-char expr; unsafe `as RecordingEvents` cast; makePost defaults partySize 4 even for lfp (LFP tests must pass null); catalog staleIds not reused in deleteMany
- Task 2: minor (deferred): effectivePostStatus treats deletedAt undefined as deleted (`!== null`)
- Task 3: minor (deferred): toPostSummaryDTO throws on missing poster member → whole board 500; createPost checks outside tx (deleted-char race → 500); datetime rejects offsets; from=5 coerces; test gaps (member view of closed, visitor full, minCp create, no event on reject)
- Task 4: minor (deferred): admin hard delete emits no post.closed (Plan 3 ignores post.closed anyway); 403 vs 404 leaks existence of soft-deleted post to strangers; test gaps (no-event for cascaded, accepted untouched by close, event order, renew deleted, delete-twice 404)
- Task 5: minor (deferred → T7): postInclude loads pending requests for board queries — add a lighter boardInclude for listBoard/me lists
- Task 5: minor (deferred): P2002 mapping ignores index name; unknown characterId on create → 404 reveals existence; autoDecline decidedAt uses new Date() not caller now; test gaps (invite decide/cancel → T6, create-vs-accept race, missing characterId)
- Task 6: minor (deferred): `let {post, request}` prefer-const; self-invite (own LFP + own recruiting) allowed; test gaps (deleted LFP poster char, invite-time ALREADY_MEMBER, lock-order concurrency)
- Task 7: minor (deferred, triage at final): deleteCharacter findMany-then-updateMany race can report/emit post.closed for a post it didn't close; concurrent double delete → P2025 500
- Task 7: minor (deferred): stranger 403 vs 404 on member removal; /me/requests no limit & shows expired posts' invites; test gaps (createdAt tie-break, isPoster after poster char deleted, non-pending excluded)
- Task 8: minor (deferred): lfpPostId branch of type-change auto-decline untested; stored-full→lfp defensive reset; same-world guild change keeps pending requests; becoming full via edit emits post.updated not post.closed{full} (consistent with accept); test gaps
- Task 9: minor (deferred): unchecked-all worlds = all (acceptable; consider "(all)" hint); mutation hooks untested (contract verified manually by reviewer); difficulty/world-toggle flows untested; post.css hardcoded colors; unused onOpen prop
- Task 10: minor (deferred): BossMultiPicker count/max-disable untested; boss-change edit untested
- Task 11: minor (deferred): no deleted-post test; closed-post test doesn't assert hidden Applicants/Remove/pill; snapshot fallback markup duplicated from PostCard; post-pill--deleted unstyled
- Task 12: minor (deferred): useMyParties/useMyPosts fetched even when no picker/invite panel open; no test Leave hidden on closed / pending Cancel disabled; ALREADY_PENDING test swaps fetch after render (brittle)
- Task 13: minor (deferred): no tests for error display / pending-disabled on My parties; "Request with <ign>" label wording; shared busy disables all rows; setParams replaces whole query; loose Lucid assertion
- Final fix wave: re-review all 11 ADDRESSED, no new breakage (commits f868edf..b186b10). Parked: postInclude.lfpInvites extra query on lock/detail paths; contrived lock inversion on type-changed pending invite; editPost becameFull ignores expiry.

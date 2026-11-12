-- LFP posts never get a party chat; the destination backfill gave some of them one.
UPDATE "Post" SET "partyForumGuildId" = NULL WHERE type = 'lfp' AND "partyForumGuildId" IS NOT NULL;

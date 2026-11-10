-- LFP posts never have a final time (only Recruiting posts are finalized). Posts made with the old
-- date picker could carry one; clear it so they read and filter as "Not set". expiresAt is left as is,
-- so no post is revived or closed by this.
UPDATE "Post" SET "scheduledAt" = NULL WHERE "type" = 'lfp' AND "scheduledAt" IS NOT NULL;

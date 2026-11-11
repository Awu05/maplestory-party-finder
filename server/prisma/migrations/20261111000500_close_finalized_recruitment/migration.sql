-- Existing scheduled recruiting posts should follow the new finalization behavior too.
UPDATE "Request" r SET status = 'declined', "decidedAt" = NOW()
WHERE r.status = 'pending' AND EXISTS (
  SELECT 1 FROM "Post" p WHERE (p.id = r."postId" OR p.id = r."lfpPostId")
    AND p.type = 'recruiting' AND p.status IN ('open', 'full')
    AND p."scheduledAt" IS NOT NULL AND p."deletedAt" IS NULL
    AND (p."expiresAt" > NOW() OR p."weeklyTimeZone" IS NOT NULL)
);

UPDATE "Post" SET status = 'closed', "closedReason" = 'finalized'
WHERE type = 'recruiting' AND status IN ('open', 'full') AND "scheduledAt" IS NOT NULL
  AND "deletedAt" IS NULL AND ("expiresAt" > NOW() OR "weeklyTimeZone" IS NOT NULL);

-- Live weekly parties that reached Discord only through the removed world fallback keep that guild
-- for their reminders: the first active guild, by id, with a webhook that serves the post's world.
UPDATE "Post" p SET "notificationGuildId" = (
  SELECT g.id FROM "Guild" g
  WHERE g.active AND g."webhookUrl" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "GuildWorld" w WHERE w."guildId" = g.id AND w."worldId" = p."worldId")
  ORDER BY g.id
  LIMIT 1
)
WHERE p."notificationGuildId" IS NULL AND p."deletedAt" IS NULL AND p."expiresAt" > NOW()
  AND p.status = 'closed' AND p."closedReason" = 'finalized'
  AND p."weeklyTimeZone" IS NOT NULL AND p."weeklyAnchorAt" IS NOT NULL;

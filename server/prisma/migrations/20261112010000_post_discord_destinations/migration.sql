ALTER TABLE "Post" ADD COLUMN "notificationGuildId" TEXT, ADD COLUMN "partyForumGuildId" TEXT;
ALTER TABLE "Post" ADD CONSTRAINT "Post_notificationGuildId_fkey" FOREIGN KEY ("notificationGuildId") REFERENCES "Guild"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_partyForumGuildId_fkey" FOREIGN KEY ("partyForumGuildId") REFERENCES "Guild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Post" p SET "notificationGuildId" = g.id
FROM "Guild" g WHERE g.id = p."guildId" AND g.active AND g."webhookUrl" IS NOT NULL
AND EXISTS (SELECT 1 FROM "GuildWorld" w WHERE w."guildId" = g.id AND w."worldId" = p."worldId");
UPDATE "Post" p SET "partyForumGuildId" = g.id
FROM "Guild" g WHERE g.id = p."guildId" AND g.active AND g."partyForumWebhookUrl" IS NOT NULL
AND EXISTS (SELECT 1 FROM "GuildWorld" w WHERE w."guildId" = g.id AND w."worldId" = p."worldId");

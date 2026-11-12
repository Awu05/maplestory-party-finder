-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "announcedGuildIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Live posts remember the guilds that received an announcement since their last closure notice.
UPDATE "Post" p SET "announcedGuildIds" = ARRAY(
  SELECT DISTINCT d."guildId" FROM "WebhookDelivery" d
  WHERE d."postId" = p.id AND d.status = 'sent'
    AND d."eventType" IN ('post.created', 'post.announcement', 'post.reopened')
    AND d."createdAt" > COALESCE((
      SELECT max(c."createdAt") FROM "WebhookDelivery" c WHERE c."postId" = p.id AND c."eventType" = 'post.closed'
    ), '-infinity'::timestamp)
  ORDER BY d."guildId"
)
WHERE p.status IN ('open', 'full') AND p."deletedAt" IS NULL;

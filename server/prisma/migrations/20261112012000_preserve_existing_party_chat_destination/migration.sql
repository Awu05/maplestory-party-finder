UPDATE "Post" p SET "partyForumGuildId" = (
  SELECT d."guildId" FROM "WebhookDelivery" d
  WHERE d."postId" = p.id AND d."eventType" = 'post.party_thread' AND d.status IN ('sent', 'pending')
  ORDER BY CASE WHEN d.status = 'sent' THEN 0 ELSE 1 END, d."createdAt" DESC, d.id DESC
  LIMIT 1
)
WHERE p."forumThreadRequested" AND EXISTS (
  SELECT 1 FROM "WebhookDelivery" d
  WHERE d."postId" = p.id AND d."eventType" = 'post.party_thread' AND d.status IN ('sent', 'pending')
);

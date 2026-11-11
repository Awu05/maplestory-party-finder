ALTER TABLE "Guild" ADD COLUMN "partyForumWebhookUrl" TEXT;
ALTER TABLE "Post" ADD COLUMN "forumThreadRequested" BOOLEAN NOT NULL DEFAULT false;

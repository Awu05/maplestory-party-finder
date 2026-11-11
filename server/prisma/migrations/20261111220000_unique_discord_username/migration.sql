-- Each Discord username (case-insensitive) can be claimed by one account. Existing duplicates are
-- resolved here instead of failing the migration.
ALTER TABLE "User" ADD COLUMN "usernameKey" TEXT;

-- Discord-linked accounts: among accounts sharing a name, the most recently created keeps the claim.
-- The others hold a stale name, which refreshes on their next Discord login.
UPDATE "User" AS u SET "usernameKey" = lower(u."username")
FROM (
  SELECT DISTINCT ON (lower("username")) "id" FROM "User"
  WHERE "discordId" IS NOT NULL AND "username" <> ''
  ORDER BY lower("username"), "createdAt" DESC, "id" DESC
) AS winner
WHERE u."id" = winner."id";

-- Typed (unlinked) names: the earliest-created account keeps a name no linked account already claims.
UPDATE "User" AS u SET "usernameKey" = lower(u."username")
FROM (
  SELECT DISTINCT ON (lower("username")) "id" FROM "User"
  WHERE "discordId" IS NULL AND "username" <> ''
  ORDER BY lower("username"), "createdAt" ASC, "id" ASC
) AS winner
WHERE u."id" = winner."id"
  AND NOT EXISTS (SELECT 1 FROM "User" AS other WHERE other."usernameKey" = lower(u."username"));

-- Unlinked accounts that lost their name must pick a new one (or link Discord).
UPDATE "User" SET "username" = '' WHERE "discordId" IS NULL AND "usernameKey" IS NULL;

CREATE UNIQUE INDEX "User_usernameKey_key" ON "User"("usernameKey");

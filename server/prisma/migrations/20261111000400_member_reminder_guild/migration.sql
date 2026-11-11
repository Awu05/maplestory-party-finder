ALTER TABLE "PostMember" ADD COLUMN "reminderGuildId" TEXT;

UPDATE "PostMember" m SET "reminderGuildId" = c."guildId"
FROM "Character" c WHERE m."characterId" = c.id;

UPDATE "PostMember" m SET "reminderGuildId" = g.id
FROM "Guild" g WHERE m."characterId" IS NULL AND m.snapshot->>'guildName' = g.name;

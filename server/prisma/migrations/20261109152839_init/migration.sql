-- CreateEnum
CREATE TYPE "WorldType" AS ENUM ('heroic', 'interactive');

-- CreateEnum
CREATE TYPE "Experience" AS ENUM ('learning', 'cleared', 'can_carry');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('ok', 'stale');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatar" TEXT,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "World" (
    "id" SERIAL NOT NULL,
    "nexonWorldId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "worldType" "WorldType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "World_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guild" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconUrl" TEXT,
    "webhookUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildWorld" (
    "guildId" TEXT NOT NULL,
    "worldId" INTEGER NOT NULL,

    CONSTRAINT "GuildWorld_pkey" PRIMARY KEY ("guildId","worldId")
);

-- CreateTable
CREATE TABLE "Boss" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Boss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BossDifficulty" (
    "id" SERIAL NOT NULL,
    "bossId" INTEGER NOT NULL,
    "difficulty" TEXT NOT NULL,
    "partyCap" INTEGER NOT NULL DEFAULT 6,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BossDifficulty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ign" TEXT NOT NULL,
    "ignLower" TEXT NOT NULL,
    "worldId" INTEGER NOT NULL,
    "jobName" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "combatPower" BIGINT NOT NULL,
    "cpUpdatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "screenshotKey" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "playTimes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'ok',
    "lastRefreshRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterBoss" (
    "characterId" TEXT NOT NULL,
    "bossDifficultyId" INTEGER NOT NULL,
    "experience" "Experience" NOT NULL,

    CONSTRAINT "CharacterBoss_pkey" PRIMARY KEY ("characterId","bossDifficultyId")
);

-- CreateTable
CREATE TABLE "RarityTier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "minCp" BIGINT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "RarityTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "World_nexonWorldId_key" ON "World"("nexonWorldId");

-- CreateIndex
CREATE UNIQUE INDEX "Guild_name_key" ON "Guild"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Boss_name_key" ON "Boss"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BossDifficulty_bossId_difficulty_key" ON "BossDifficulty"("bossId", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "Character_ignLower_worldId_key" ON "Character"("ignLower", "worldId");

-- CreateIndex
CREATE UNIQUE INDEX "RarityTier_name_key" ON "RarityTier"("name");

-- AddForeignKey
ALTER TABLE "GuildWorld" ADD CONSTRAINT "GuildWorld_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildWorld" ADD CONSTRAINT "GuildWorld_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BossDifficulty" ADD CONSTRAINT "BossDifficulty_bossId_fkey" FOREIGN KEY ("bossId") REFERENCES "Boss"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterBoss" ADD CONSTRAINT "CharacterBoss_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterBoss" ADD CONSTRAINT "CharacterBoss_bossDifficultyId_fkey" FOREIGN KEY ("bossDifficultyId") REFERENCES "BossDifficulty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

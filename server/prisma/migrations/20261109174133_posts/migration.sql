-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('lfp', 'recruiting');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('open', 'full', 'closed');

-- CreateEnum
CREATE TYPE "RequestKind" AS ENUM ('join_request', 'invite');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'accepted', 'declined', 'cancelled');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('poster', 'member');

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "type" "PostType" NOT NULL,
    "posterUserId" TEXT NOT NULL,
    "posterCharacterId" TEXT,
    "worldId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "partySize" INTEGER,
    "minCp" BIGINT,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "PostStatus" NOT NULL DEFAULT 'open',
    "closedReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostBoss" (
    "postId" TEXT NOT NULL,
    "bossDifficultyId" INTEGER NOT NULL,

    CONSTRAINT "PostBoss_pkey" PRIMARY KEY ("postId","bossDifficultyId")
);

-- CreateTable
CREATE TABLE "PostMember" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "characterId" TEXT,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "cpAtJoin" BIGINT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "kind" "RequestKind" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "postId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "lfpPostId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Post_status_expiresAt_idx" ON "Post"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PostMember_userId_idx" ON "PostMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PostMember_postId_characterId_key" ON "PostMember"("postId", "characterId");

-- CreateIndex
CREATE INDEX "Request_characterId_status_idx" ON "Request"("characterId", "status");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_posterUserId_fkey" FOREIGN KEY ("posterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_posterCharacterId_fkey" FOREIGN KEY ("posterCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostBoss" ADD CONSTRAINT "PostBoss_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostBoss" ADD CONSTRAINT "PostBoss_bossDifficultyId_fkey" FOREIGN KEY ("bossDifficultyId") REFERENCES "BossDifficulty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMember" ADD CONSTRAINT "PostMember_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMember" ADD CONSTRAINT "PostMember_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMember" ADD CONSTRAINT "PostMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_lfpPostId_fkey" FOREIGN KEY ("lfpPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one pending request per post and character
CREATE UNIQUE INDEX "Request_one_pending" ON "Request"("postId", "characterId") WHERE "status" = 'pending';

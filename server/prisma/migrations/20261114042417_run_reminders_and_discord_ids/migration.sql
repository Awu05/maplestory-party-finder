/*
  Warnings:

  - A unique constraint covering the columns `[typedDiscordId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "PasskeyChallenge" ADD COLUMN     "typedDiscordId" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "partyThreadId" TEXT,
ADD COLUMN     "reminderOffsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "typedDiscordId" TEXT;

-- CreateTable
CREATE TABLE "PostReminderSent" (
    "postId" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostReminderSent_pkey" PRIMARY KEY ("postId","offsetMinutes","runAt")
);

-- CreateIndex
CREATE INDEX "PostReminderSent_runAt_idx" ON "PostReminderSent"("runAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_typedDiscordId_key" ON "User"("typedDiscordId");

-- AddForeignKey
ALTER TABLE "PostReminderSent" ADD CONSTRAINT "PostReminderSent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

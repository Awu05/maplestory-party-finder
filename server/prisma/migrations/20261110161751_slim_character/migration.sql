/*
  Warnings:

  - You are about to drop the column `note` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the column `playTimes` on the `Character` table. All the data in the column will be lost.
  - You are about to drop the `CharacterBoss` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CharacterBoss" DROP CONSTRAINT "CharacterBoss_bossDifficultyId_fkey";

-- DropForeignKey
ALTER TABLE "CharacterBoss" DROP CONSTRAINT "CharacterBoss_characterId_fkey";

-- AlterTable
ALTER TABLE "Character" DROP COLUMN "note",
DROP COLUMN "playTimes";

-- DropTable
DROP TABLE "CharacterBoss";

-- DropEnum
DROP TYPE "Experience";

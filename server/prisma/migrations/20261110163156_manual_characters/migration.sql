-- CreateEnum
CREATE TYPE "CharacterSource" AS ENUM ('nexon', 'manual');

-- DropForeignKey
ALTER TABLE "Character" DROP CONSTRAINT "Character_guildId_fkey";

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "source" "CharacterSource" NOT NULL DEFAULT 'nexon',
ALTER COLUMN "guildId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

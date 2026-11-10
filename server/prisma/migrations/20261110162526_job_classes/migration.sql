-- CreateEnum
CREATE TYPE "Archetype" AS ENUM ('warrior', 'magician', 'bowman', 'thief', 'pirate', 'xenon', 'unknown');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "archetype" "Archetype" NOT NULL DEFAULT 'unknown';

-- CreateTable
CREATE TABLE "JobClass" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nameLower" TEXT NOT NULL,
    "archetype" "Archetype" NOT NULL,

    CONSTRAINT "JobClass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobClass_nameLower_key" ON "JobClass"("nameLower");

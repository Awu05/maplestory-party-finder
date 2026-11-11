-- AlterTable
ALTER TABLE "PostMember" ADD COLUMN     "freeTimes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "freeTimesZone" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "freeTimes" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "freeTimesZone" TEXT;

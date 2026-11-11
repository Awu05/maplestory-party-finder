-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "weeklyAnchorAt" TIMESTAMP(3),
ADD COLUMN     "weeklyTimeZone" TEXT;

-- CreateIndex
CREATE INDEX "Post_weeklyTimeZone_scheduledAt_idx" ON "Post"("weeklyTimeZone", "scheduledAt");

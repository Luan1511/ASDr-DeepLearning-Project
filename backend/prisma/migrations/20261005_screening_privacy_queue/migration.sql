-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "VideoUpload" ADD COLUMN     "consentId" TEXT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "videoDeletedAt" TIMESTAMP(3),
ADD COLUMN     "videoHeight" INTEGER,
ADD COLUMN     "videoWidth" INTEGER;

-- AlterTable
ALTER TABLE "ScreeningResult" ADD COLUMN     "asdProbability" DOUBLE PRECISION,
ADD COLUMN     "calibrated" BOOLEAN,
ADD COLUMN     "decisionThreshold" DOUBLE PRECISION,
ADD COLUMN     "gaitFeatures" JSONB,
ADD COLUMN     "highRiskThreshold" DOUBLE PRECISION,
ADD COLUMN     "modelVersion" TEXT,
ALTER COLUMN "eyeContactScore" DROP NOT NULL,
ALTER COLUMN "motorPatternScore" DROP NOT NULL,
ALTER COLUMN "responseBehaviorScore" DROP NOT NULL,
ALTER COLUMN "repetitiveBehaviorScore" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "scopes" TEXT[],
    "statement" JSONB,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningJob" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_childId_idx" ON "ConsentRecord"("childId");

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_idx" ON "ConsentRecord"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningJob_videoId_key" ON "ScreeningJob"("videoId");

-- CreateIndex
CREATE INDEX "ScreeningJob_status_runAfter_idx" ON "ScreeningJob"("status", "runAfter");

-- AddForeignKey
ALTER TABLE "VideoUpload" ADD CONSTRAINT "VideoUpload_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "ConsentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningJob" ADD CONSTRAINT "ScreeningJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "VideoUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;


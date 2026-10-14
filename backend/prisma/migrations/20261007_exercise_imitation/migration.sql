-- Giai đoạn 4: exercises, templates, practice sessions, imitation scores.
-- Additive only (new types/tables/indexes; foreign keys only on the new tables).
-- Shared DB: apply per master_prompt.md §5.4 (db execute in a transaction + migrate resolve).

-- CreateEnum
CREATE TYPE "ExerciseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MirrorPolicy" AS ENUM ('EITHER', 'ANATOMICAL_ONLY', 'MIRROR_ONLY');

-- CreateEnum
CREATE TYPE "ExerciseSessionStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SCORED', 'INSUFFICIENT', 'FAILED');

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "childPrompt" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "bodyFocus" TEXT[],
    "source" TEXT NOT NULL DEFAULT 'ADMIN',
    "status" "ExerciseStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "currentTemplateId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseTemplate" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sourceSubjectId" TEXT,
    "sourceAttestation" JSONB,
    "sourceMlSubjectDeletedAt" TIMESTAMP(3),
    "sourceFps" DOUBLE PRECISION NOT NULL,
    "fpsSource" TEXT NOT NULL,
    "mirrorPolicy" "MirrorPolicy" NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "templateHash" TEXT NOT NULL,
    "activeStartSec" DOUBLE PRECISION NOT NULL,
    "activeEndSec" DOUBLE PRECISION NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "lateralized" BOOLEAN NOT NULL,
    "activeParts" TEXT[],
    "guideTrack" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "quality" JSONB NOT NULL,
    "selfTest" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "consentId" TEXT,
    "status" "ExerciseSessionStatus" NOT NULL DEFAULT 'QUEUED',
    "recordedVia" TEXT NOT NULL,
    "practiceMode" TEXT NOT NULL,
    "playbackRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "guideOffsetMs" INTEGER,
    "storedFilename" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "videoWidth" INTEGER,
    "videoHeight" INTEGER,
    "videoDeletedAt" TIMESTAMP(3),
    "mlSubjectId" TEXT,
    "mlSubjectDeletedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionScore" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "templateHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "overall" INTEGER,
    "stars" INTEGER,
    "band" TEXT,
    "mode" TEXT,
    "reasonCodes" TEXT[],
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_slug_key" ON "Exercise"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_currentTemplateId_key" ON "Exercise"("currentTemplateId");

-- CreateIndex
CREATE INDEX "Exercise_status_sortOrder_idx" ON "Exercise"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "ExerciseTemplate_templateHash_idx" ON "ExerciseTemplate"("templateHash");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseTemplate_exerciseId_version_key" ON "ExerciseTemplate"("exerciseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseSession_mlSubjectId_key" ON "ExerciseSession"("mlSubjectId");

-- CreateIndex
CREATE INDEX "ExerciseSession_childId_exerciseId_createdAt_idx" ON "ExerciseSession"("childId", "exerciseId", "createdAt");

-- CreateIndex
CREATE INDEX "ExerciseSession_status_runAfter_idx" ON "ExerciseSession"("status", "runAfter");

-- CreateIndex
CREATE INDEX "ExerciseSession_userId_idx" ON "ExerciseSession"("userId");

-- CreateIndex
CREATE INDEX "SessionScore_templateId_idx" ON "SessionScore"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionScore_sessionId_algorithmVersion_key" ON "SessionScore"("sessionId", "algorithmVersion");

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_currentTemplateId_fkey" FOREIGN KEY ("currentTemplateId") REFERENCES "ExerciseTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseTemplate" ADD CONSTRAINT "ExerciseTemplate_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSession" ADD CONSTRAINT "ExerciseSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSession" ADD CONSTRAINT "ExerciseSession_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSession" ADD CONSTRAINT "ExerciseSession_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSession" ADD CONSTRAINT "ExerciseSession_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExerciseTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSession" ADD CONSTRAINT "ExerciseSession_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "ConsentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionScore" ADD CONSTRAINT "SessionScore_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExerciseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionScore" ADD CONSTRAINT "SessionScore_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExerciseTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

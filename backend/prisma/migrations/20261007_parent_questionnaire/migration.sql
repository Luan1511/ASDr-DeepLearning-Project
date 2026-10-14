-- Parent questionnaires (M-CHAT-R/F answer entry by item number; no item wording).
-- Additive only. Shared DB: apply per master_prompt.md §5.4.

-- CreateTable
CREATE TABLE "QuestionnaireResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "structureVersion" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "contentVersion" TEXT,
    "respondent" TEXT NOT NULL,
    "childAgeMonths" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "failedItems" INTEGER[],
    "followUpStatus" TEXT NOT NULL,
    "followUpSource" TEXT,
    "followUpFailedItems" INTEGER[],
    "followUpFailCount" INTEGER,
    "followUpAnswers" JSONB,
    "followUpCompletedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL,
    "rescreenAfter" TIMESTAMP(3),
    "consentVersion" TEXT NOT NULL,
    "consentStatement" JSONB NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionnaireResponse_childId_completedAt_idx" ON "QuestionnaireResponse"("childId", "completedAt");

-- CreateIndex
CREATE INDEX "QuestionnaireResponse_userId_idx" ON "QuestionnaireResponse"("userId");

-- AddForeignKey
ALTER TABLE "QuestionnaireResponse" ADD CONSTRAINT "QuestionnaireResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireResponse" ADD CONSTRAINT "QuestionnaireResponse_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

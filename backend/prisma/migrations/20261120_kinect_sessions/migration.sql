CREATE TABLE "KinectSession" (
  "id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"childId" TEXT NOT NULL,"consentId" TEXT NOT NULL,"deviceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY',"captureId" TEXT,"captureSha256" TEXT,"rawCapture" TEXT,"frameCount" INTEGER,
  "trimStart" INTEGER,"trimEnd" INTEGER,"result" JSONB,"modelBundleVersion" TEXT,"modelBundleSha256" TEXT,
  "startCommandId" TEXT,"stopCommandId" TEXT,"errorMessage" TEXT,"sourceSessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KinectSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KinectSession_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KinectSession_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "ConsentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "KinectSession_userId_createdAt_idx" ON "KinectSession"("userId","createdAt");
CREATE INDEX "KinectSession_childId_idx" ON "KinectSession"("childId");
CREATE UNIQUE INDEX "KinectSession_active_device" ON "KinectSession"("deviceId") WHERE "status" IN ('STARTING','RECORDING','STOPPING','AWAITING_CAPTURE');
CREATE TABLE "KinectJob" (
 "id" TEXT NOT NULL PRIMARY KEY,"sessionId" TEXT NOT NULL UNIQUE,"status" TEXT NOT NULL DEFAULT 'QUEUED',"attempts" INTEGER NOT NULL DEFAULT 0,
 "maxAttempts" INTEGER NOT NULL DEFAULT 5,"runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"lockedBy" TEXT,"lockedAt" TIMESTAMP(3),"lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "KinectJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "KinectSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "KinectJob_status_runAfter_idx" ON "KinectJob"("status","runAfter");

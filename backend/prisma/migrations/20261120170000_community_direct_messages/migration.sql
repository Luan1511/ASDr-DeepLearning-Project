CREATE TABLE "CommunityConversation" (
 "id" TEXT PRIMARY KEY, "memberAId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "memberBId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "inviterId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "sourcePostId" TEXT,
 "readSeqA" INTEGER NOT NULL DEFAULT 0, "readSeqB" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "CommunityConversation_status_check" CHECK ("status" IN ('PENDING','ACCEPTED','DECLINED','CANCELLED')),
 CONSTRAINT "CommunityConversation_pair_check" CHECK ("memberAId" < "memberBId")
);
CREATE UNIQUE INDEX "CommunityConversation_memberAId_memberBId_key" ON "CommunityConversation"("memberAId","memberBId");
CREATE INDEX "CommunityConversation_memberAId_updatedAt_idx" ON "CommunityConversation"("memberAId","updatedAt");
CREATE INDEX "CommunityConversation_memberBId_updatedAt_idx" ON "CommunityConversation"("memberBId","updatedAt");
CREATE TABLE "CommunityDirectMessage" (
 "id" TEXT PRIMARY KEY, "seq" SERIAL NOT NULL UNIQUE, "conversationId" TEXT NOT NULL REFERENCES "CommunityConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "senderId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "clientRequestId" TEXT NOT NULL, "content" TEXT NOT NULL, "hiddenAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CommunityDirectMessage_senderId_clientRequestId_key" ON "CommunityDirectMessage"("senderId","clientRequestId");
CREATE INDEX "CommunityDirectMessage_conversationId_seq_idx" ON "CommunityDirectMessage"("conversationId","seq");
CREATE INDEX "CommunityDirectMessage_senderId_createdAt_idx" ON "CommunityDirectMessage"("senderId","createdAt");
ALTER TABLE "CommunityReport" ADD COLUMN "directMessageId" TEXT REFERENCES "CommunityDirectMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunityNotification" ADD COLUMN "conversationId" TEXT;

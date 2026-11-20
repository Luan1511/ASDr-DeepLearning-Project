-- Additive migration: retain all historical messages and their original IDs.
CREATE TABLE "ChatConversation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ChatMessage" ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "position" INTEGER,
  ADD COLUMN "sources" JSONB;

INSERT INTO "ChatConversation" ("id", "userId", "title", "createdAt", "updatedAt")
SELECT 'legacy-' || "userId", "userId", 'Hội thoại trước đây', MIN("createdAt"), MAX("createdAt")
FROM "ChatMessage" GROUP BY "userId";

WITH ordered AS (
  SELECT "id", 'legacy-' || "userId" AS conversation_id,
    ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt",
      CASE WHEN "role" = 'USER' THEN 0 ELSE 1 END, "id")::INTEGER AS position
  FROM "ChatMessage"
)
UPDATE "ChatMessage" AS m SET "conversationId" = o.conversation_id, "position" = o.position
FROM ordered o WHERE m."id" = o."id";

CREATE INDEX "ChatConversation_userId_updatedAt_id_idx" ON "ChatConversation"("userId", "updatedAt", "id");
CREATE UNIQUE INDEX "ChatMessage_conversationId_position_key" ON "ChatMessage"("conversationId", "position");
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Archive legacy shared request messages before drop
CREATE TABLE IF NOT EXISTS "RequestMessage_Archive" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "senderUserId" TEXT,
  "senderName" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "RequestMessage_Archive" ("id", "workspaceId", "requestId", "senderUserId", "senderName", "body", "createdAt")
SELECT m."id", m."workspaceId", m."requestId", m."senderUserId", m."senderName", m."body", m."createdAt"
FROM "RequestMessage" m
ON CONFLICT ("id") DO NOTHING;

-- DropForeignKey
ALTER TABLE "RequestMessage" DROP CONSTRAINT "RequestMessage_requestId_fkey";

-- DropForeignKey
ALTER TABLE "RequestMessage" DROP CONSTRAINT "RequestMessage_workspaceId_fkey";

-- DropTable
DROP TABLE "RequestMessage";

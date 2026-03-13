-- CreateEnum
CREATE TYPE "OfficeCommunityChannelKey" AS ENUM ('GENERAL_HELP', 'ADMIN_HELP', 'COVERAGE', 'UPDATES');

-- CreateTable
CREATE TABLE "OfficeCommunityChannel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" "OfficeCommunityChannelKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeCommunityChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeCommunityMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeCommunityMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfficeCommunityChannel_workspaceId_key_key" ON "OfficeCommunityChannel"("workspaceId", "key");
CREATE INDEX "OfficeCommunityChannel_workspaceId_idx" ON "OfficeCommunityChannel"("workspaceId");
CREATE INDEX "OfficeCommunityChannel_workspaceId_key_idx" ON "OfficeCommunityChannel"("workspaceId", "key");

CREATE INDEX "OfficeCommunityMessage_workspaceId_idx" ON "OfficeCommunityMessage"("workspaceId");
CREATE INDEX "OfficeCommunityMessage_channelId_idx" ON "OfficeCommunityMessage"("channelId");
CREATE INDEX "OfficeCommunityMessage_workspaceId_channelId_createdAt_idx" ON "OfficeCommunityMessage"("workspaceId", "channelId", "createdAt");

-- AddForeignKey
ALTER TABLE "OfficeCommunityChannel" ADD CONSTRAINT "OfficeCommunityChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficeCommunityMessage" ADD CONSTRAINT "OfficeCommunityMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfficeCommunityMessage" ADD CONSTRAINT "OfficeCommunityMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "OfficeCommunityChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

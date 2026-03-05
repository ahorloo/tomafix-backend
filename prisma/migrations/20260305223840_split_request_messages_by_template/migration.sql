-- CreateTable
CREATE TABLE "ApartmentRequestMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApartmentRequestMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstateRequestMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstateRequestMessage_pkey" PRIMARY KEY ("id")
);

-- Backfill from shared request messages
INSERT INTO "ApartmentRequestMessage" ("id", "workspaceId", "requestId", "senderUserId", "senderName", "body", "createdAt")
SELECT m."id", m."workspaceId", m."requestId", m."senderUserId", m."senderName", m."body", m."createdAt"
FROM "RequestMessage" m
JOIN "Workspace" w ON w."id" = m."workspaceId"
JOIN "ApartmentRequest" ar ON ar."id" = m."requestId"
WHERE w."templateType" = 'APARTMENT'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "EstateRequestMessage" ("id", "workspaceId", "requestId", "senderUserId", "senderName", "body", "createdAt")
SELECT m."id", m."workspaceId", m."requestId", m."senderUserId", m."senderName", m."body", m."createdAt"
FROM "RequestMessage" m
JOIN "Workspace" w ON w."id" = m."workspaceId"
JOIN "EstateRequest" er ON er."id" = m."requestId"
WHERE w."templateType" = 'ESTATE'
ON CONFLICT ("id") DO NOTHING;

-- CreateIndex
CREATE INDEX "ApartmentRequestMessage_workspaceId_idx" ON "ApartmentRequestMessage"("workspaceId");

-- CreateIndex
CREATE INDEX "ApartmentRequestMessage_requestId_idx" ON "ApartmentRequestMessage"("requestId");

-- CreateIndex
CREATE INDEX "ApartmentRequestMessage_workspaceId_requestId_createdAt_idx" ON "ApartmentRequestMessage"("workspaceId", "requestId", "createdAt");

-- CreateIndex
CREATE INDEX "ApartmentRequestMessage_createdAt_idx" ON "ApartmentRequestMessage"("createdAt");

-- CreateIndex
CREATE INDEX "EstateRequestMessage_workspaceId_idx" ON "EstateRequestMessage"("workspaceId");

-- CreateIndex
CREATE INDEX "EstateRequestMessage_requestId_idx" ON "EstateRequestMessage"("requestId");

-- CreateIndex
CREATE INDEX "EstateRequestMessage_workspaceId_requestId_createdAt_idx" ON "EstateRequestMessage"("workspaceId", "requestId", "createdAt");

-- CreateIndex
CREATE INDEX "EstateRequestMessage_createdAt_idx" ON "EstateRequestMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "ApartmentRequestMessage" ADD CONSTRAINT "ApartmentRequestMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentRequestMessage" ADD CONSTRAINT "ApartmentRequestMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApartmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateRequestMessage" ADD CONSTRAINT "EstateRequestMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstateRequestMessage" ADD CONSTRAINT "EstateRequestMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EstateRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;


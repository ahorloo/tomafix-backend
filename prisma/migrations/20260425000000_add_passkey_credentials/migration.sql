-- CreateTable: PasskeyCredential
-- Stores WebAuthn passkey credentials per user for device-based login

CREATE TABLE "PasskeyCredential" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey"    BYTEA NOT NULL,
    "counter"      BIGINT NOT NULL DEFAULT 0,
    "deviceName"   TEXT,
    "aaguid"       TEXT,
    "transports"   TEXT[],
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt"   TIMESTAMP(3),

    CONSTRAINT "PasskeyCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique credential ID
CREATE UNIQUE INDEX "PasskeyCredential_credentialId_key" ON "PasskeyCredential"("credentialId");

-- CreateIndex: look up passkeys by user
CREATE INDEX "PasskeyCredential_userId_idx" ON "PasskeyCredential"("userId");

-- AddForeignKey: cascade delete when user is deleted
ALTER TABLE "PasskeyCredential" ADD CONSTRAINT "PasskeyCredential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

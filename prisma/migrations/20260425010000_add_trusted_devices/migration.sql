-- CreateTable: TrustedDevice
-- Stores "Remember this device" tokens so users skip OTP on trusted devices

CREATE TABLE "TrustedDevice" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "deviceName" TEXT,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique token hash
CREATE UNIQUE INDEX "TrustedDevice_tokenHash_key" ON "TrustedDevice"("tokenHash");

-- CreateIndex: look up trusted devices by user
CREATE INDEX "TrustedDevice_userId_idx" ON "TrustedDevice"("userId");

-- AddForeignKey: cascade delete when user is deleted
ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

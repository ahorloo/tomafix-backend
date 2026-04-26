-- Add attempts counter to OtpCode
-- Tracks wrong guesses; OTP is burned after 5 failed attempts

ALTER TABLE "OtpCode" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- Migration: add_onboarding_reminder
-- Tracks whether the onboarding reminder email has been sent to incomplete workspaces

ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "onboardingReminderSentAt" TIMESTAMP(3);

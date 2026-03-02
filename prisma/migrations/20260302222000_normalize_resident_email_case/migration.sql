-- Normalize resident emails to lowercase for consistent tenant-resident matching
UPDATE "Resident"
SET email = lower(email)
WHERE email IS NOT NULL;
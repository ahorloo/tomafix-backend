ALTER TABLE "Estate"
ADD COLUMN "locationMapsUrl" TEXT,
ADD COLUMN "locationLatitude" DOUBLE PRECISION,
ADD COLUMN "locationLongitude" DOUBLE PRECISION,
ADD COLUMN "locationVerifiedAt" TIMESTAMP(3);

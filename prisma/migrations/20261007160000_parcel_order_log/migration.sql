-- AlterTable
ALTER TABLE "ManifestParcel" ADD COLUMN "bsOrderId" TEXT,
ADD COLUMN "scannedBy" TEXT,
ADD COLUMN "scannedAt" TIMESTAMP(3),
ADD COLUMN "orderLog" JSONB,
ADD COLUMN "orderLogFetchedAt" TIMESTAMP(3);

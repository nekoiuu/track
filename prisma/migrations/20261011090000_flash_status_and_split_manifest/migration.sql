-- ใบนำจ่ายเดียวแบ่งขึ้นหลายคัน: จำนวนที่คันนี้รับไปจากใบนี้
ALTER TABLE "PickupManifest" ADD COLUMN "parcelCount" INTEGER;

-- สถานะจากเว็บ Flash Express
ALTER TABLE "ManifestParcel" ADD COLUMN "flashState" INTEGER,
ADD COLUMN "flashStateText" TEXT,
ADD COLUMN "flashLastRoute" TEXT,
ADD COLUMN "flashRoutedAt" TIMESTAMP(3),
ADD COLUMN "flashRoutes" JSONB,
ADD COLUMN "flashFetchedAt" TIMESTAMP(3),
ADD COLUMN "flashNotFound" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ManifestParcel_flashFetchedAt_idx" ON "ManifestParcel"("flashFetchedAt");

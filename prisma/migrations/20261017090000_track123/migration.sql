-- Track123: สถานะจากตัวกลางหลายขนส่ง (Flash / SPX) สำหรับชิ้นที่มีปัญหา/ค้าง
ALTER TABLE "ManifestParcel" ADD COLUMN     "trkCourier" TEXT,
ADD COLUMN     "trkStatus" TEXT,
ADD COLUMN     "trkSubStatus" TEXT,
ADD COLUMN     "trkLastEvent" TEXT,
ADD COLUMN     "trkEventAt" TIMESTAMP(3),
ADD COLUMN     "trkEvents" JSONB,
ADD COLUMN     "trkRegisteredAt" TIMESTAMP(3),
ADD COLUMN     "trkFetchedAt" TIMESTAMP(3),
ADD COLUMN     "trkError" TEXT;

-- CreateIndex
CREATE INDEX "ManifestParcel_trkRegisteredAt_idx" ON "ManifestParcel"("trkRegisteredAt");

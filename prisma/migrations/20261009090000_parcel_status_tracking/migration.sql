-- AlterTable
ALTER TABLE "ManifestParcel" ADD COLUMN "bsStatusChangedAt" TIMESTAMP(3),
ADD COLUMN "trackingDoneAt" TIMESTAMP(3);

-- เคยดึงสถานะแล้ว: ใช้เวลาแก้แถวล่าสุดเป็นจุดเริ่มนับ "ค้าง"
UPDATE "ManifestParcel" SET "bsStatusChangedAt" = "updatedAt" WHERE "bsStatusText" IS NOT NULL;

-- CreateIndex
CREATE INDEX "ManifestParcel_trackingDoneAt_idx" ON "ManifestParcel"("trackingDoneAt");

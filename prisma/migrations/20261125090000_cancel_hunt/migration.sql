-- ตามหาของยกเลิก — ดึงออเดอร์ที่ยกเลิกวันนี้จาก BigSeller ทุก 5 นาที ให้เจ้าหน้าที่หาของออกมาก่อนขึ้นรถ
-- ตารางใหม่ทั้งหมด ไม่แตะตารางเดิม — โค้ดเก่าที่รันอยู่ไม่กระทบ

-- CreateEnum
CREATE TYPE "CancelHuntStatus" AS ENUM ('PENDING', 'FOUND', 'MISSING', 'SKIPPED');

-- CreateTable
CREATE TABLE "CancelHunt" (
    "id" TEXT NOT NULL,
    "bsOrderId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "packageNo" TEXT,
    "orderNo" TEXT,
    "platform" TEXT,
    "shopName" TEXT,
    "trackingNo" TEXT,
    "carrier" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelBy" TEXT,
    "beforeStatus" TEXT,
    "labelPrintedAt" TIMESTAMP(3),
    "pickPrintedAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "items" JSONB,
    "needsFind" BOOLEAN NOT NULL DEFAULT false,
    "parcelId" TEXT,
    "status" "CancelHuntStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "note" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancelHunt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CancelHunt_bsOrderId_key" ON "CancelHunt"("bsOrderId");
CREATE INDEX "CancelHunt_day_needsFind_status_idx" ON "CancelHunt"("day", "needsFind", "status");
CREATE INDEX "CancelHunt_trackingNo_idx" ON "CancelHunt"("trackingNo");
CREATE INDEX "CancelHunt_packageNo_idx" ON "CancelHunt"("packageNo");

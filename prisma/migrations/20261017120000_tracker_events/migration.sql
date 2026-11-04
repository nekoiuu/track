-- ตัวดึงสถานะแยกโปรเซส: คิวเช็คต่อชิ้น + เหตุการณ์สถานะเปลี่ยน
ALTER TABLE "ManifestParcel" ADD COLUMN     "nextCheckAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ParcelEvent" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "trackingNo" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "ParcelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManifestParcel_nextCheckAt_idx" ON "ManifestParcel"("nextCheckAt");

-- CreateIndex
CREATE INDEX "ParcelEvent_createdAt_idx" ON "ParcelEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ParcelEvent_parcelId_createdAt_idx" ON "ParcelEvent"("parcelId", "createdAt");

-- AddForeignKey
ALTER TABLE "ParcelEvent" ADD CONSTRAINT "ParcelEvent_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ManifestParcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

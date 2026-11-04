-- CreateEnum
CREATE TYPE "ParcelStatus" AS ENUM ('SHIPPED', 'DELIVERED', 'RETURNING', 'RETURNED', 'PROBLEM');

-- CreateTable
CREATE TABLE "Pickup" (
    "id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "carrier" TEXT,
    "driverName" TEXT,
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "departedAt" TIMESTAMP(3),
    "parcelCount" INTEGER,
    "recordedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pickup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupManifest" (
    "id" TEXT NOT NULL,
    "pickupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "manifestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manifest" (
    "id" TEXT NOT NULL,
    "manifestNo" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "logisticsName" TEXT,
    "printedAt" TIMESTAMP(3),
    "bigsellerInfo" TEXT,
    "source" TEXT NOT NULL DEFAULT 'bigseller',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManifestParcel" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "trackingNo" TEXT NOT NULL,
    "orderNo" TEXT,
    "platform" TEXT,
    "shopName" TEXT,
    "packageNo" TEXT,
    "items" JSONB,
    "itemsSyncedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'bigseller',
    "status" "ParcelStatus" NOT NULL DEFAULT 'SHIPPED',
    "statusNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManifestParcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnScan" (
    "id" TEXT NOT NULL,
    "trackingNo" TEXT NOT NULL,
    "parcelId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedBy" TEXT,
    "condition" TEXT,
    "note" TEXT,

    CONSTRAINT "ReturnScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "errorKind" TEXT,
    "message" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pickup_arrivedAt_idx" ON "Pickup"("arrivedAt");

-- CreateIndex
CREATE INDEX "Pickup_plate_idx" ON "Pickup"("plate");

-- CreateIndex
CREATE INDEX "PickupManifest_manifestId_idx" ON "PickupManifest"("manifestId");

-- CreateIndex
CREATE UNIQUE INDEX "PickupManifest_pickupId_code_key" ON "PickupManifest"("pickupId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Manifest_manifestNo_key" ON "Manifest"("manifestNo");

-- CreateIndex
CREATE INDEX "Manifest_last4_idx" ON "Manifest"("last4");

-- CreateIndex
CREATE INDEX "Manifest_printedAt_idx" ON "Manifest"("printedAt");

-- CreateIndex
CREATE INDEX "ManifestParcel_trackingNo_idx" ON "ManifestParcel"("trackingNo");

-- CreateIndex
CREATE INDEX "ManifestParcel_orderNo_idx" ON "ManifestParcel"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "ManifestParcel_manifestId_trackingNo_key" ON "ManifestParcel"("manifestId", "trackingNo");

-- CreateIndex
CREATE INDEX "ReturnScan_trackingNo_idx" ON "ReturnScan"("trackingNo");

-- CreateIndex
CREATE INDEX "ReturnScan_receivedAt_idx" ON "ReturnScan"("receivedAt");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- AddForeignKey
ALTER TABLE "PickupManifest" ADD CONSTRAINT "PickupManifest_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "Pickup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupManifest" ADD CONSTRAINT "PickupManifest_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManifestParcel" ADD CONSTRAINT "ManifestParcel_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnScan" ADD CONSTRAINT "ReturnScan_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ManifestParcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

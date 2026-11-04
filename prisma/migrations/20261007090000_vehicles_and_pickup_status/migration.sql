-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('DOING', 'DONE');

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "carrier" TEXT,
    "driverName" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Pickup" ADD COLUMN "status" "PickupStatus" NOT NULL DEFAULT 'DOING',
ADD COLUMN "vehicleId" TEXT;

-- รอบรถเดิม: มีเวลาออกแล้ว = ปิดงานแล้ว
UPDATE "Pickup" SET "status" = 'DONE' WHERE "departedAt" IS NOT NULL;

-- สร้างรถจากทะเบียนที่เคยจด แล้วผูกรอบรถเดิมเข้ากับรถ
INSERT INTO "Vehicle" ("id", "plate", "carrier", "driverName", "lastUsedAt", "updatedAt")
SELECT 'v_' || md5(p."plate"), p."plate",
       (ARRAY_AGG(p."carrier" ORDER BY p."arrivedAt" DESC) FILTER (WHERE p."carrier" IS NOT NULL))[1],
       (ARRAY_AGG(p."driverName" ORDER BY p."arrivedAt" DESC) FILTER (WHERE p."driverName" IS NOT NULL))[1],
       MAX(p."arrivedAt"), CURRENT_TIMESTAMP
FROM "Pickup" p
GROUP BY p."plate";

UPDATE "Pickup" p SET "vehicleId" = v."id" FROM "Vehicle" v WHERE v."plate" = p."plate";

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plate_key" ON "Vehicle"("plate");

-- CreateIndex
CREATE INDEX "Vehicle_active_lastUsedAt_idx" ON "Vehicle"("active", "lastUsedAt");

-- CreateIndex
CREATE INDEX "Pickup_status_idx" ON "Pickup"("status");

-- CreateIndex
CREATE INDEX "Pickup_vehicleId_idx" ON "Pickup"("vehicleId");

-- AddForeignKey
ALTER TABLE "Pickup" ADD CONSTRAINT "Pickup_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

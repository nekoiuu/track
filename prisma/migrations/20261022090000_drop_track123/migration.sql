-- ถอด Track123 + webhook ส่ง event ออก (ไม่มีโค้ดใช้แล้ว)

-- DropIndex
DROP INDEX IF EXISTS "ManifestParcel_trkRegisteredAt_idx";

-- AlterTable
ALTER TABLE "ManifestParcel" DROP COLUMN IF EXISTS "trkCourier",
DROP COLUMN IF EXISTS "trkStatus",
DROP COLUMN IF EXISTS "trkSubStatus",
DROP COLUMN IF EXISTS "trkLastEvent",
DROP COLUMN IF EXISTS "trkEventAt",
DROP COLUMN IF EXISTS "trkEvents",
DROP COLUMN IF EXISTS "trkRegisteredAt",
DROP COLUMN IF EXISTS "trkFetchedAt",
DROP COLUMN IF EXISTS "trkError";

-- AlterTable
ALTER TABLE "ParcelEvent" DROP COLUMN IF EXISTS "deliveredAt";

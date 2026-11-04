-- เอาสถานะ "ยกเลิกก่อนขึ้นรถ" ออก (ตอนลบไม่มีแถวไหนใช้อยู่)
-- AlterEnum
BEGIN;
CREATE TYPE "ParcelStatus_new" AS ENUM ('SHIPPED', 'DELIVERED', 'RETURNING', 'RETURNED', 'PROBLEM', 'CANCELLED_AFTER');
ALTER TABLE "public"."ManifestParcel" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ManifestParcel" ALTER COLUMN "status" TYPE "ParcelStatus_new" USING ("status"::text::"ParcelStatus_new");
ALTER TYPE "ParcelStatus" RENAME TO "ParcelStatus_old";
ALTER TYPE "ParcelStatus_new" RENAME TO "ParcelStatus";
DROP TYPE "public"."ParcelStatus_old";
ALTER TABLE "ManifestParcel" ALTER COLUMN "status" SET DEFAULT 'SHIPPED';
COMMIT;


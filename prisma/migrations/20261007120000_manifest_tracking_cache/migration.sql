-- AlterTable
ALTER TABLE "Manifest" ADD COLUMN "parcelCount" INTEGER,
ADD COLUMN "trackingsFetchedAt" TIMESTAMP(3);

-- จำนวนกล่องจากค่า manifestInfomation ที่เก็บไว้แล้ว (เป็นตัวเลขล้วนเท่านั้น)
UPDATE "Manifest" SET "parcelCount" = "bigsellerInfo"::INTEGER WHERE "bigsellerInfo" ~ '^[0-9]+$';

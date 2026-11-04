-- AlterTable
ALTER TABLE "User" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- ผู้ใช้ที่มีอยู่แล้วถือว่าอนุมัติแล้ว
UPDATE "User" SET "approvedAt" = "createdAt" WHERE "approvedAt" IS NULL;

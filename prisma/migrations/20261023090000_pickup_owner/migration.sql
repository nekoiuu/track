-- เจ้าของรอบรถ — staff เห็นเฉพาะงานของตัวเอง แอดมินเห็นทุกงาน

-- AlterTable
ALTER TABLE "Pickup" ADD COLUMN "createdById" TEXT;

-- CreateIndex
CREATE INDEX "Pickup_createdById_status_idx" ON "Pickup"("createdById", "status");

-- AddForeignKey
ALTER TABLE "Pickup" ADD CONSTRAINT "Pickup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- รอบเก่า: จับคู่จากชื่อผู้จด (recordedBy = User.name) เฉพาะชื่อที่มีผู้ใช้คนเดียว · ที่เหลือ = ไม่มีเจ้าของ (แอดมินเท่านั้น)
UPDATE "Pickup" p
SET "createdById" = u.id
FROM "User" u
WHERE p."createdById" IS NULL
  AND p."recordedBy" = u.name
  AND (SELECT count(*) FROM "User" x WHERE x.name = u.name) = 1;

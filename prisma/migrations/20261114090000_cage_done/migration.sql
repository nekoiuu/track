-- กรง "ขนหมดแล้ว" — คนจดกดเมื่อของในกรงขึ้นรถไปครบ → ใบในกรงนี้จดเข้ารถคันอื่นอีกไม่ได้
-- คอลัมน์ใหม่ว่างได้ทั้งคู่ — โค้ดเก่าที่รันอยู่ไม่กระทบ (รัน migration ก่อน deploy โค้ดใหม่)

-- AlterTable
ALTER TABLE "Cage" ADD COLUMN "doneAt" TIMESTAMP(3),
ADD COLUMN "doneBy" TEXT;

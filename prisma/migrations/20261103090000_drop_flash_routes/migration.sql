-- เส้นทางพัสดุ Flash ทั้งหมด (JSON) — 108 MB = 40% ของตาราง ManifestParcel เขียนทับทุกครั้งที่เช็ค Flash
-- ใช้แค่ตอนเปิดหน้าพัสดุ → เปลี่ยนเป็นถาม Flash สดตอนเปิด (src/lib/flash.ts: flashRoutesFor) · เก็บแค่ flashLastRoute
-- ⚠️ deploy โค้ดใหม่ก่อน แล้วค่อยรัน migration นี้ — โค้ดเก่ายังเขียนคอลัมน์นี้อยู่
-- DROP COLUMN แค่แก้โครงสร้าง (ทันที) · พื้นที่คืนเมื่อแถวถูกเขียนใหม่ หรือ VACUUM FULL "ManifestParcel" ตอนคนใช้น้อย

-- AlterTable
ALTER TABLE "ManifestParcel" DROP COLUMN "flashRoutes";

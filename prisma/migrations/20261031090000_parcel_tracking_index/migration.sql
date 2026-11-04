-- แท็บ "สถานะไม่อัปเดต" กรองพัสดุด้วย manifestId IN (ใบที่ขึ้นรถในช่วง) แล้วดู status / flashState / flashRoutedAt / bsState
-- index เดิมมีแค่ manifestId (นำหน้า unique) → ต้องอ่านแถวเต็มทุกชิ้นในช่วง (43k แถว ~5 วินาทีบน Nano)
-- index นี้ครอบทุกช่องที่ใช้ → Postgres ตอบจาก index ได้ (index-only scan)

-- CreateIndex
CREATE INDEX "ManifestParcel_tracking_idx" ON "ManifestParcel"("manifestId", "status", "flashState", "flashRoutedAt", "bsState");

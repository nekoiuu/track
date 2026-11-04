-- แท็บ "ยกเลิก ยังไม่คืน" กรอง bsState = 'canceled' — ไม่มี index ต้องอ่านพัสดุทั้งตาราง

-- CreateIndex
CREATE INDEX "ManifestParcel_bsState_idx" ON "ManifestParcel"("bsState");

-- หน้าติดตามสถานะ: กรองเร็วขึ้น
CREATE INDEX "ManifestParcel_status_idx" ON "ManifestParcel"("status");
CREATE INDEX "ManifestParcel_flashState_flashRoutedAt_idx" ON "ManifestParcel"("flashState", "flashRoutedAt");
CREATE INDEX "ManifestParcel_flashNotFound_idx" ON "ManifestParcel"("flashNotFound");
CREATE INDEX "ManifestParcel_createdAt_idx" ON "ManifestParcel"("createdAt");
CREATE INDEX "ReturnScan_parcelId_idx" ON "ReturnScan"("parcelId");
CREATE INDEX "Pickup_status_departedAt_idx" ON "Pickup"("status", "departedAt");

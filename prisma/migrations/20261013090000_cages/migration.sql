-- กรง: 1 กรงมีหลาย manifest และขึ้นรถได้หลายคัน
CREATE TABLE "Cage" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "originPickupId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Cage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupCage" (
    "id" TEXT NOT NULL,
    "pickupId" TEXT NOT NULL,
    "cageId" TEXT NOT NULL,
    "share" DOUBLE PRECISION,
    "count" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickupCage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PickupManifest" ADD COLUMN "cageId" TEXT;

CREATE INDEX "Cage_createdAt_idx" ON "Cage"("createdAt");
CREATE INDEX "Cage_originPickupId_idx" ON "Cage"("originPickupId");
CREATE UNIQUE INDEX "PickupCage_pickupId_cageId_key" ON "PickupCage"("pickupId", "cageId");
CREATE INDEX "PickupCage_cageId_idx" ON "PickupCage"("cageId");
CREATE INDEX "PickupManifest_cageId_idx" ON "PickupManifest"("cageId");

ALTER TABLE "Cage" ADD CONSTRAINT "Cage_originPickupId_fkey" FOREIGN KEY ("originPickupId") REFERENCES "Pickup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PickupCage" ADD CONSTRAINT "PickupCage_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "Pickup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PickupCage" ADD CONSTRAINT "PickupCage_cageId_fkey" FOREIGN KEY ("cageId") REFERENCES "Cage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PickupManifest" ADD CONSTRAINT "PickupManifest_cageId_fkey" FOREIGN KEY ("cageId") REFERENCES "Cage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

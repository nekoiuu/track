-- CreateTable
CREATE TABLE "BigSellerSession" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "cookie" TEXT NOT NULL,
    "envSeed" TEXT,
    "rotatedAt" TIMESTAMP(3),
    "rotations" INTEGER NOT NULL DEFAULT 0,
    "lastOkAt" TIMESTAMP(3),
    "lastKeepAliveAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorKind" TEXT,
    "lastError" TEXT,
    "deadCookie" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BigSellerSession_pkey" PRIMARY KEY ("id")
);


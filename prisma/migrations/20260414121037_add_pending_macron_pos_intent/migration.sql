-- CreateTable
CREATE TABLE "PendingMacronPosIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'macron_pos',
    "fulfillmentMode" TEXT NOT NULL,
    "takeNow" BOOLEAN,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "normalizedVariantId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "hasFee" BOOLEAN NOT NULL DEFAULT false,
    "isBundle" BOOLEAN NOT NULL DEFAULT false,
    "bundleSummary" TEXT,
    "fingerprint" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "matchedOrderId" TEXT
);

-- CreateTable
CREATE TABLE "PendingGiftCardActivation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "intentToken" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lineItemUuid" TEXT,
    "lineItemTitle" TEXT,
    "orderId" TEXT,
    "orderName" TEXT,
    "giftCardId" TEXT,
    "lastError" TEXT,
    "activationAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3)
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingGiftCardActivation_shop_intentToken_key" ON "PendingGiftCardActivation"("shop", "intentToken");

-- CreateIndex
CREATE UNIQUE INDEX "PendingGiftCardActivation_shop_orderId_code_key" ON "PendingGiftCardActivation"("shop", "orderId", "code");

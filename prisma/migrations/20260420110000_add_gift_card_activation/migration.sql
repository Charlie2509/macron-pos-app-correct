-- CreateTable
CREATE TABLE "MacronPosGiftCardActivation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "sourceName" TEXT,
    "code" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'GBP',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "activationAttemptId" TEXT,
    "giftCardId" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "activatedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "MacronPosGiftCardActivation_shop_order_code_key" ON "MacronPosGiftCardActivation"("shop", "orderId", "code");

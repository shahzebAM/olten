BEGIN;

-- AlterTable
ALTER TABLE "OrderSlip" ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "processedBy" TEXT;

-- AlterTable
ALTER TABLE "OrderSlipItem" ADD COLUMN     "physicalConfirmedQty" INTEGER,
ADD COLUMN     "shortageQty" INTEGER,
ADD COLUMN     "warehouseQty" INTEGER;

-- CreateTable
CREATE TABLE "Shortage" (
    "id" TEXT NOT NULL,
    "orderSlipId" TEXT NOT NULL,
    "orderSlipItemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Shortage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shortage_orderSlipItemId_key" ON "Shortage"("orderSlipItemId");

-- CreateIndex
CREATE INDEX "Shortage_orderSlipId_idx" ON "Shortage"("orderSlipId");

-- CreateIndex
CREATE INDEX "Shortage_status_createdAt_idx" ON "Shortage"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shortage_orderSlipItemId_orderSlipId_key" ON "Shortage"("orderSlipItemId", "orderSlipId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSlipItem_id_orderSlipId_key" ON "OrderSlipItem"("id", "orderSlipId");

-- AddForeignKey
ALTER TABLE "Shortage" ADD CONSTRAINT "Shortage_orderSlipId_fkey" FOREIGN KEY ("orderSlipId") REFERENCES "OrderSlip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortage" ADD CONSTRAINT "Shortage_orderSlipItemId_orderSlipId_fkey" FOREIGN KEY ("orderSlipItemId", "orderSlipId") REFERENCES "OrderSlipItem"("id", "orderSlipId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing unverified lines remain NULL. Verified lines must agree with the
-- shortage formula even when written outside the processing endpoint.
ALTER TABLE "OrderSlipItem" ADD CONSTRAINT "OrderSlipItem_physical_verification_check" CHECK (
    ("physicalConfirmedQty" IS NULL AND "shortageQty" IS NULL AND "warehouseQty" IS NULL)
    OR ("physicalConfirmedQty" IS NOT NULL AND "physicalConfirmedQty" >= 0
        AND "shortageQty" IS NOT NULL AND "warehouseQty" IS NOT NULL
        AND "shortageQty" = GREATEST(0, "requestedQty" - "physicalConfirmedQty"))
);

ALTER TABLE "Shortage" ADD CONSTRAINT "Shortage_status_check" CHECK (
    "status" IN ('Open', 'Pending Purchase', 'Ordered', 'Partially Fulfilled', 'Fulfilled', 'Cancelled')
);

COMMIT;

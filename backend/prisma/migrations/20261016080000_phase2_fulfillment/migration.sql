BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "expiryControlled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serialControlled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "binId" TEXT,
ADD COLUMN     "lotId" TEXT,
ADD COLUMN     "serialNumber" TEXT;

-- CreateTable
CREATE TABLE "WarehouseBin" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "building" TEXT NOT NULL,
    "floor" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "rack" TEXT NOT NULL,
    "shelf" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseBin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLot" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "warehouseStockId" TEXT,
    "binId" TEXT,
    "receiptLineId" TEXT,
    "batchNumber" TEXT,
    "serialNumber" TEXT,
    "expirationDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "WarehouseLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleCount" (
    "id" TEXT NOT NULL,
    "adjNumber" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "recountReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CycleCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleCountLine" (
    "id" TEXT NOT NULL,
    "cycleCountId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "expectedReservedQty" INTEGER NOT NULL,
    "expectedVersion" INTEGER NOT NULL,
    "countedQty" INTEGER,
    "countedBy" TEXT,
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "CycleCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL,
    "soNumber" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "hospitalPoNumber" TEXT,
    "sourceOrderSlipId" TEXT,
    "sourceOsNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "deliveredQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "dispatchedQty" INTEGER NOT NULL DEFAULT 0,
    "releasedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomingAllocation" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "shipmentLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomingAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "delNumber" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "scheduledAt" TIMESTAMP(3),
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "notes" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "dispatchedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryItem" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "deliveredQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeliveryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPick" (
    "id" TEXT NOT NULL,
    "deliveryItemId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "verifiedQty" INTEGER NOT NULL DEFAULT 0,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverySource" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "deliveryId" TEXT NOT NULL,

    CONSTRAINT "DeliverySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPod" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "receiptUrl" TEXT,
    "documentId" INTEGER,
    "notes" TEXT,
    "items" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryPod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseBin_company_warehouseId_idx" ON "WarehouseBin"("company", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseBin_company_code_key" ON "WarehouseBin"("company", "code");

-- CreateIndex
CREATE INDEX "WarehouseLot_company_productId_warehouseId_status_idx" ON "WarehouseLot"("company", "productId", "warehouseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLot_company_productId_serialNumber_key" ON "WarehouseLot"("company", "productId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CycleCount_adjNumber_key" ON "CycleCount"("adjNumber");

-- CreateIndex
CREATE INDEX "CycleCount_company_status_idx" ON "CycleCount"("company", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CycleCountLine_cycleCountId_lotId_key" ON "CycleCountLine"("cycleCountId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_soNumber_key" ON "CustomerOrder"("soNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_sourceOrderSlipId_key" ON "CustomerOrder"("sourceOrderSlipId");

-- CreateIndex
CREATE INDEX "CustomerOrder_company_status_idx" ON "CustomerOrder"("company", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrderLine_orderId_productId_key" ON "CustomerOrderLine"("orderId", "productId");

-- CreateIndex
CREATE INDEX "StockReservation_orderLineId_lotId_idx" ON "StockReservation"("orderLineId", "lotId");

-- CreateIndex
CREATE INDEX "IncomingAllocation_shipmentLineId_idx" ON "IncomingAllocation"("shipmentLineId");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingAllocation_orderLineId_shipmentLineId_key" ON "IncomingAllocation"("orderLineId", "shipmentLineId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_delNumber_key" ON "Delivery"("delNumber");

-- CreateIndex
CREATE INDEX "Delivery_company_status_idx" ON "Delivery"("company", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryItem_deliveryId_orderLineId_key" ON "DeliveryItem"("deliveryId", "orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPick_deliveryItemId_reservationId_key" ON "DeliveryPick"("deliveryItemId", "reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySource_company_sourceType_sourceId_key" ON "DeliverySource"("company", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "DeliveryPod_deliveryId_idx" ON "DeliveryPod"("deliveryId");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "WarehouseLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_binId_fkey" FOREIGN KEY ("binId") REFERENCES "WarehouseBin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLot" ADD CONSTRAINT "WarehouseLot_warehouseStockId_fkey" FOREIGN KEY ("warehouseStockId") REFERENCES "WarehouseStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLot" ADD CONSTRAINT "WarehouseLot_binId_fkey" FOREIGN KEY ("binId") REFERENCES "WarehouseBin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLot" ADD CONSTRAINT "WarehouseLot_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCountLine" ADD CONSTRAINT "CycleCountLine_cycleCountId_fkey" FOREIGN KEY ("cycleCountId") REFERENCES "CycleCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCountLine" ADD CONSTRAINT "CycleCountLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "WarehouseLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrderLine" ADD CONSTRAINT "CustomerOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "CustomerOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "WarehouseLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingAllocation" ADD CONSTRAINT "IncomingAllocation_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "CustomerOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "CustomerOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPick" ADD CONSTRAINT "DeliveryPick_deliveryItemId_fkey" FOREIGN KEY ("deliveryItemId") REFERENCES "DeliveryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPick" ADD CONSTRAINT "DeliveryPick_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "StockReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPick" ADD CONSTRAINT "DeliveryPick_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "WarehouseLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySource" ADD CONSTRAINT "DeliverySource_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPod" ADD CONSTRAINT "DeliveryPod_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Physical quantities include reservations; each serial identifies at most one unit.
ALTER TABLE "WarehouseLot" ADD CONSTRAINT "WarehouseLot_balances_check" CHECK ("quantity" >= 0 AND "reservedQty" >= 0 AND "reservedQty" <= "quantity" AND "version" >= 0);
ALTER TABLE "WarehouseLot" ADD CONSTRAINT "WarehouseLot_serial_check" CHECK ("serialNumber" IS NULL OR "quantity" <= 1);
ALTER TABLE "WarehouseLot" ADD CONSTRAINT "WarehouseLot_status_check" CHECK ("status" IN ('AVAILABLE', 'QUARANTINE', 'DAMAGED', 'REJECTED'));
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_balances_check" CHECK ("quantity" > 0 AND "dispatchedQty" >= 0 AND "releasedQty" >= 0 AND "dispatchedQty" + "releasedQty" <= "quantity");
ALTER TABLE "CustomerOrderLine" ADD CONSTRAINT "CustomerOrderLine_balances_check" CHECK ("quantity" > 0 AND "deliveredQty" >= 0 AND "deliveredQty" <= "quantity");
ALTER TABLE "DeliveryItem" ADD CONSTRAINT "DeliveryItem_balances_check" CHECK ("quantity" > 0 AND "deliveredQty" >= 0 AND "deliveredQty" <= "quantity");
ALTER TABLE "DeliveryPick" ADD CONSTRAINT "DeliveryPick_balances_check" CHECK ("quantity" > 0 AND "verifiedQty" >= 0 AND "verifiedQty" <= "quantity");
ALTER TABLE "IncomingAllocation" ADD CONSTRAINT "IncomingAllocation_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "CycleCountLine" ADD CONSTRAINT "CycleCountLine_balances_check" CHECK ("expectedQty" >= 0 AND "expectedReservedQty" >= 0 AND "expectedReservedQty" <= "expectedQty" AND ("countedQty" IS NULL OR "countedQty" >= 0));

COMMIT;

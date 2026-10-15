-- Apply this release atomically and fail promptly if an active transaction blocks DDL.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "importFileId" TEXT,
ADD COLUMN     "productId" INTEGER,
ADD COLUMN     "regulatoryStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
ADD COLUMN     "shipmentId" TEXT;

-- CreateTable
CREATE TABLE "ImportSequence" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ImportSequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PurchaseRequisition" (
    "id" TEXT NOT NULL,
    "prNumber" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "neededBy" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "rejectionReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "purchaseOrderId" TEXT,
    "selectedQuotationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequisitionItem" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "PurchaseRequisitionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQuotation" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "exchangeRate" DECIMAL(18,6) NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "paymentTerms" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "requisitionItemId" TEXT NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "minimumOrderQty" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SupplierQuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportFile" (
    "id" TEXT NOT NULL,
    "importNumber" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "shipmentNumber" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "importFileId" TEXT NOT NULL,
    "forwarder" TEXT,
    "carrier" TEXT,
    "mode" TEXT NOT NULL,
    "blAwbNumber" TEXT,
    "containerReference" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "revisedEta" TIMESTAMP(3),
    "actualArrival" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "shippedQty" INTEGER NOT NULL,
    "clearedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentClearance" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "broker" TEXT,
    "declarationReference" TEXT,
    "entryReference" TEXT,
    "clearanceDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentClearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportExpense" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "amount" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Estimated',
    "invoiceReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "shipmentLineId" TEXT NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "acceptedQty" INTEGER NOT NULL,
    "rejectedQty" INTEGER NOT NULL,
    "heldQty" INTEGER NOT NULL,
    "placedQty" INTEGER NOT NULL DEFAULT 0,
    "batchNumber" TEXT,
    "expirationDate" TIMESTAMP(3),
    "photos" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "inspectedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequisition_prNumber_key" ON "PurchaseRequisition"("prNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequisition_purchaseOrderId_key" ON "PurchaseRequisition"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequisition_selectedQuotationId_key" ON "PurchaseRequisition"("selectedQuotationId");

-- CreateIndex
CREATE INDEX "PurchaseRequisition_company_status_idx" ON "PurchaseRequisition"("company", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequisitionItem_requisitionId_productId_key" ON "PurchaseRequisitionItem"("requisitionId", "productId");

-- CreateIndex
CREATE INDEX "SupplierQuotation_requisitionId_idx" ON "SupplierQuotation"("requisitionId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuotationItem_quotationId_requisitionItemId_key" ON "SupplierQuotationItem"("quotationId", "requisitionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportFile_importNumber_key" ON "ImportFile"("importNumber");

-- CreateIndex
CREATE INDEX "ImportFile_company_status_idx" ON "ImportFile"("company", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shipmentNumber_key" ON "Shipment"("shipmentNumber");

-- CreateIndex
CREATE INDEX "Shipment_company_status_idx" ON "Shipment"("company", "status");

-- CreateIndex
CREATE INDEX "ShipmentLine_purchaseOrderItemId_idx" ON "ShipmentLine"("purchaseOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentLine_shipmentId_purchaseOrderItemId_key" ON "ShipmentLine"("shipmentId", "purchaseOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentClearance_shipmentId_key" ON "ShipmentClearance"("shipmentId");

-- CreateIndex
CREATE INDEX "ImportExpense_shipmentId_status_idx" ON "ImportExpense"("shipmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_grnNumber_key" ON "GoodsReceipt"("grnNumber");

-- CreateIndex
CREATE INDEX "GoodsReceipt_company_shipmentId_idx" ON "GoodsReceipt"("company", "shipmentId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_shipmentLineId_idx" ON "GoodsReceiptLine"("shipmentLineId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptLine_receiptId_shipmentLineId_key" ON "GoodsReceiptLine"("receiptId", "shipmentLineId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_importFileId_fkey" FOREIGN KEY ("importFileId") REFERENCES "ImportFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_selectedQuotationId_fkey" FOREIGN KEY ("selectedQuotationId") REFERENCES "SupplierQuotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisitionItem" ADD CONSTRAINT "PurchaseRequisitionItem_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "PurchaseRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisitionItem" ADD CONSTRAINT "PurchaseRequisitionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "PurchaseRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuotation" ADD CONSTRAINT "SupplierQuotation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuotationItem" ADD CONSTRAINT "SupplierQuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "SupplierQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuotationItem" ADD CONSTRAINT "SupplierQuotationItem_requisitionItemId_fkey" FOREIGN KEY ("requisitionItemId") REFERENCES "PurchaseRequisitionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_importFileId_fkey" FOREIGN KEY ("importFileId") REFERENCES "ImportFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentClearance" ADD CONSTRAINT "ShipmentClearance_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportExpense" ADD CONSTRAINT "ImportExpense_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "ShipmentLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

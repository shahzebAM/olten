-- Phase 1: Purchase Requisitions, Quotations, Import Files, Shipments, Customs & Clearance, GRN & QC Quarantine
-- This migration only adds NEW tables. Existing tables are untouched.

-- ============================================================
-- 1. PURCHASE REQUISITIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS "PurchaseRequisition" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "prNumber"        TEXT NOT NULL,
    "company"         TEXT NOT NULL,
    "requestedBy"     TEXT NOT NULL,
    "department"      TEXT,
    "purpose"         TEXT,
    "status"          TEXT NOT NULL DEFAULT 'Draft',
    "priority"        TEXT NOT NULL DEFAULT 'Normal',
    "neededBy"        TIMESTAMP(3),
    "approvedBy"      TEXT,
    "approvedAt"      TIMESTAMP(3),
    "rejectedBy"      TEXT,
    "rejectedAt"      TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes"           TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseRequisition_prNumber_key" ON "PurchaseRequisition"("prNumber");
CREATE INDEX IF NOT EXISTS "PurchaseRequisition_company_idx" ON "PurchaseRequisition"("company");

CREATE TABLE IF NOT EXISTS "PurchaseRequisitionItem" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "requisitionId" TEXT NOT NULL,
    "productId"     INTEGER,
    "sku"           TEXT,
    "productName"   TEXT NOT NULL,
    "requestedQty"  DOUBLE PRECISION NOT NULL,
    "unit"          TEXT NOT NULL DEFAULT 'pcs',
    "estimatedCost" DOUBLE PRECISION,
    "notes"         TEXT,
    CONSTRAINT "PurchaseRequisitionItem_requisitionId_fkey"
        FOREIGN KEY ("requisitionId") REFERENCES "PurchaseRequisition"("id") ON DELETE CASCADE
);

-- ============================================================
-- 2. SUPPLIER QUOTATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS "SupplierQuotation" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "sqNumber"     TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "supplierId"   TEXT,
    "supplierName" TEXT NOT NULL,
    "currency"     TEXT NOT NULL DEFAULT 'PHP',
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "paymentTerms" TEXT,
    "leadTimeDays" INTEGER,
    "validUntil"   TIMESTAMP(3),
    "status"       TEXT NOT NULL DEFAULT 'Pending',
    "approvedBy"   TEXT,
    "approvedAt"   TIMESTAMP(3),
    "notes"        TEXT,
    "createdBy"    TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierQuotation_requisitionId_fkey"
        FOREIGN KEY ("requisitionId") REFERENCES "PurchaseRequisition"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierQuotation_sqNumber_key" ON "SupplierQuotation"("sqNumber");
CREATE INDEX IF NOT EXISTS "SupplierQuotation_requisitionId_idx" ON "SupplierQuotation"("requisitionId");

CREATE TABLE IF NOT EXISTS "SupplierQuotationItem" (
    "id"               TEXT NOT NULL PRIMARY KEY,
    "quotationId"      TEXT NOT NULL,
    "productId"        INTEGER,
    "sku"              TEXT,
    "productName"      TEXT NOT NULL,
    "moq"              DOUBLE PRECISION NOT NULL DEFAULT 1,
    "quotedQty"        DOUBLE PRECISION NOT NULL,
    "unitPriceForeign" DOUBLE PRECISION NOT NULL,
    "unitPricePhp"     DOUBLE PRECISION NOT NULL,
    "lineTotal"        DOUBLE PRECISION NOT NULL,
    CONSTRAINT "SupplierQuotationItem_quotationId_fkey"
        FOREIGN KEY ("quotationId") REFERENCES "SupplierQuotation"("id") ON DELETE CASCADE
);

-- ============================================================
-- 3. PURCHASE ORDER → REQUISITION LINK + SHIPMENT LINKS
-- ============================================================
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "requisitionId" TEXT;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT IF NOT EXISTS "PurchaseOrder_requisitionId_fkey"
    FOREIGN KEY ("requisitionId") REFERENCES "PurchaseRequisition"("id");

-- ============================================================
-- 4. IMPORT FILES
-- ============================================================
CREATE TABLE IF NOT EXISTS "ImportFile" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "impNumber"    TEXT NOT NULL,
    "company"      TEXT NOT NULL,
    "title"        TEXT,
    "supplierId"   TEXT,
    "supplierName" TEXT,
    "origin"       TEXT,
    "status"       TEXT NOT NULL DEFAULT 'Open',
    "notes"        TEXT,
    "createdBy"    TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ImportFile_impNumber_key" ON "ImportFile"("impNumber");
CREATE INDEX IF NOT EXISTS "ImportFile_company_idx" ON "ImportFile"("company");

-- ============================================================
-- 5. SHIPMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS "Shipment" (
    "id"                TEXT NOT NULL PRIMARY KEY,
    "shpNumber"         TEXT NOT NULL,
    "importFileId"      TEXT NOT NULL,
    "company"           TEXT NOT NULL,
    "forwarder"         TEXT,
    "carrier"           TEXT,
    "shippingMode"      TEXT,
    "blAwbNumber"       TEXT,
    "containerRef"      TEXT,
    "portOfOrigin"      TEXT,
    "portOfDestination" TEXT,
    "etd"               TIMESTAMP(3),
    "eta"               TIMESTAMP(3),
    "revisedEta"        TIMESTAMP(3),
    "actualArrival"     TIMESTAMP(3),
    "status"            TEXT NOT NULL DEFAULT 'Pending',
    "delayReason"       TEXT,
    "notes"             TEXT,
    "createdBy"         TEXT NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Shipment_importFileId_fkey"
        FOREIGN KEY ("importFileId") REFERENCES "ImportFile"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Shipment_shpNumber_key" ON "Shipment"("shpNumber");
CREATE INDEX IF NOT EXISTS "Shipment_importFileId_idx" ON "Shipment"("importFileId");
CREATE INDEX IF NOT EXISTS "Shipment_company_idx" ON "Shipment"("company");

-- ============================================================
-- 6. SHIPMENT ↔ PO MANY-TO-MANY JOIN
-- ============================================================
CREATE TABLE IF NOT EXISTS "ShipmentPO" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "poId"       TEXT NOT NULL,
    "addedBy"    TEXT,
    "addedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShipmentPO_shipmentId_fkey"
        FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE,
    CONSTRAINT "ShipmentPO_poId_fkey"
        FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentPO_shipmentId_poId_key" ON "ShipmentPO"("shipmentId","poId");

-- ============================================================
-- 7. DOCUMENT → IMPORT FILE / SHIPMENT LINKS
-- ============================================================
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "importFileId" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "shipmentId"   TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "docLinkStatus" TEXT;
ALTER TABLE "Document" ADD CONSTRAINT IF NOT EXISTS "Document_importFileId_fkey"
    FOREIGN KEY ("importFileId") REFERENCES "ImportFile"("id");
ALTER TABLE "Document" ADD CONSTRAINT IF NOT EXISTS "Document_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id");

-- ============================================================
-- 8. CUSTOMS ENTRIES
-- ============================================================
CREATE TABLE IF NOT EXISTS "CustomsEntry" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "ceNumber"       TEXT NOT NULL,
    "shipmentId"     TEXT NOT NULL,
    "company"        TEXT NOT NULL,
    "brokerName"     TEXT,
    "declarationRef" TEXT,
    "clearanceDate"  TIMESTAMP(3),
    "status"         TEXT NOT NULL DEFAULT 'Pending',
    "notes"          TEXT,
    "createdBy"      TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomsEntry_shipmentId_fkey"
        FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomsEntry_ceNumber_key" ON "CustomsEntry"("ceNumber");
CREATE INDEX IF NOT EXISTS "CustomsEntry_shipmentId_idx" ON "CustomsEntry"("shipmentId");

-- ============================================================
-- 9. IMPORT EXPENSES
-- ============================================================
CREATE TABLE IF NOT EXISTS "ImportExpense" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "customsEntryId" TEXT NOT NULL,
    "company"        TEXT NOT NULL,
    "expenseType"    TEXT NOT NULL,
    "description"    TEXT,
    "currency"       TEXT NOT NULL DEFAULT 'PHP',
    "exchangeRate"   DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "amountForeign"  DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountPhp"      DOUBLE PRECISION NOT NULL,
    "paymentStatus"  TEXT NOT NULL DEFAULT 'Estimated',
    "invoiceRef"     TEXT,
    "paidAt"         TIMESTAMP(3),
    "createdBy"      TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportExpense_customsEntryId_fkey"
        FOREIGN KEY ("customsEntryId") REFERENCES "CustomsEntry"("id") ON DELETE CASCADE
);

-- ============================================================
-- 10. GOODS RECEIPTS (GRN)
-- ============================================================
CREATE TABLE IF NOT EXISTS "GoodsReceipt" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "grnNumber"  TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "company"    TEXT NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status"     TEXT NOT NULL DEFAULT 'Draft',
    "remarks"    TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsReceipt_shipmentId_fkey"
        FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GoodsReceipt_grnNumber_key" ON "GoodsReceipt"("grnNumber");
CREATE INDEX IF NOT EXISTS "GoodsReceipt_shipmentId_idx" ON "GoodsReceipt"("shipmentId");
CREATE INDEX IF NOT EXISTS "GoodsReceipt_company_idx" ON "GoodsReceipt"("company");

-- ============================================================
-- 11. GOODS RECEIPT LINES
-- ============================================================
CREATE TABLE IF NOT EXISTS "GoodsReceiptLine" (
    "id"                TEXT NOT NULL PRIMARY KEY,
    "grnId"             TEXT NOT NULL,
    "poId"              TEXT,
    "poItemId"          TEXT,
    "productId"         INTEGER,
    "sku"               TEXT NOT NULL,
    "productName"       TEXT NOT NULL,
    "batchNumber"       TEXT,
    "expirationDate"    TIMESTAMP(3),
    "orderedQty"        INTEGER NOT NULL DEFAULT 0,
    "shippedQty"        INTEGER NOT NULL DEFAULT 0,
    "clearedQty"        INTEGER NOT NULL DEFAULT 0,
    "receivedQty"       INTEGER NOT NULL DEFAULT 0,
    "acceptedQty"       INTEGER NOT NULL DEFAULT 0,
    "rejectedQty"       INTEGER NOT NULL DEFAULT 0,
    "qcStatus"          TEXT NOT NULL DEFAULT 'Pending',
    "qcNotes"           TEXT,
    "photoUrls"         JSONB DEFAULT '[]',
    "quarantineStatus"  TEXT,
    "quarantineReason"  TEXT,
    "pushedToInventory" BOOLEAN NOT NULL DEFAULT false,
    "pushedAt"          TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoodsReceiptLine_grnId_fkey"
        FOREIGN KEY ("grnId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE
);

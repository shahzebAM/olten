BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "landedCostReference" DECIMAL(18,6);

-- CreateTable
CREATE TABLE "LandedCost" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "allocationMethod" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'PHP',
    "data" JSONB NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandedCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCostHistory" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "landedCostId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(18,6) NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCostHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceDocument" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sourceKey" TEXT,
    "deliveryId" TEXT,
    "relatedDocumentId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "exchangeRate" DECIMAL(18,6) NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "data" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "postedBy" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePayment" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "FinanceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "data" JSONB NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingJournal" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "memo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "postedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL,
    "credit" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingMapping" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(18,2) NOT NULL,
    "closingBalance" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "ledgerEntryId" TEXT,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAsset" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "warrantyUntil" TIMESTAMP(3),
    "nextMaintenanceAt" TIMESTAMP(3),
    "intervalMonths" INTEGER NOT NULL DEFAULT 6,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceVisit" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "technician" TEXT NOT NULL,
    "notes" TEXT,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpAuditLog" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "actorId" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LandedCost_number_key" ON "LandedCost"("number");

-- CreateIndex
CREATE INDEX "LandedCost_company_status_idx" ON "LandedCost"("company", "status");

-- CreateIndex
CREATE INDEX "LandedCost_shipmentId_idx" ON "LandedCost"("shipmentId");

-- CreateIndex
CREATE INDEX "ProductCostHistory_company_productId_createdAt_idx" ON "ProductCostHistory"("company", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductCostHistory_shipmentId_idx" ON "ProductCostHistory"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCostHistory_landedCostId_productId_key" ON "ProductCostHistory"("landedCostId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceDocument_number_key" ON "FinanceDocument"("number");

-- CreateIndex
CREATE INDEX "FinanceDocument_company_direction_status_dueDate_idx" ON "FinanceDocument"("company", "direction", "status", "dueDate");

-- CreateIndex
CREATE INDEX "FinanceDocument_company_partyId_idx" ON "FinanceDocument"("company", "partyId");

-- CreateIndex
CREATE INDEX "FinanceDocument_deliveryId_idx" ON "FinanceDocument"("deliveryId");

-- CreateIndex
CREATE INDEX "FinanceDocument_relatedDocumentId_idx" ON "FinanceDocument"("relatedDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceDocument_company_sourceKey_key" ON "FinanceDocument"("company", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePayment_number_key" ON "FinancePayment"("number");

-- CreateIndex
CREATE INDEX "FinancePayment_company_direction_partyId_idx" ON "FinancePayment"("company", "direction", "partyId");

-- CreateIndex
CREATE INDEX "FinancePayment_company_paidAt_idx" ON "FinancePayment"("company", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePayment_company_idempotencyKey_key" ON "FinancePayment"("company", "idempotencyKey");

-- CreateIndex
CREATE INDEX "FinanceAllocation_documentId_idx" ON "FinanceAllocation"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAllocation_paymentId_documentId_key" ON "FinanceAllocation"("paymentId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_number_key" ON "PaymentRequest"("number");

-- CreateIndex
CREATE INDEX "PaymentRequest_company_status_dueDate_idx" ON "PaymentRequest"("company", "status", "dueDate");

-- CreateIndex
CREATE INDEX "PaymentRequest_supplierId_idx" ON "PaymentRequest"("supplierId");

-- CreateIndex
CREATE INDEX "PaymentRequest_paymentId_idx" ON "PaymentRequest"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_company_code_key" ON "LedgerAccount"("company", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingJournal_number_key" ON "AccountingJournal"("number");

-- CreateIndex
CREATE INDEX "AccountingJournal_company_date_idx" ON "AccountingJournal"("company", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingJournal_company_sourceKey_key" ON "AccountingJournal"("company", "sourceKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_journalId_idx" ON "LedgerEntry"("journalId");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_idx" ON "LedgerEntry"("accountId");

-- CreateIndex
CREATE INDEX "AccountingMapping_accountId_idx" ON "AccountingMapping"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingMapping_company_kind_sourceId_key" ON "AccountingMapping"("company", "kind", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliation_number_key" ON "BankReconciliation"("number");

-- CreateIndex
CREATE INDEX "BankReconciliation_company_status_idx" ON "BankReconciliation"("company", "status");

-- CreateIndex
CREATE INDEX "BankReconciliation_accountId_idx" ON "BankReconciliation"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_ledgerEntryId_key" ON "BankStatementLine"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "BankStatementLine_reconciliationId_idx" ON "BankStatementLine"("reconciliationId");

-- CreateIndex
CREATE INDEX "DeviceAsset_company_nextMaintenanceAt_idx" ON "DeviceAsset"("company", "nextMaintenanceAt");

-- CreateIndex
CREATE INDEX "DeviceAsset_productId_idx" ON "DeviceAsset"("productId");

-- CreateIndex
CREATE INDEX "DeviceAsset_customerId_idx" ON "DeviceAsset"("customerId");

-- CreateIndex
CREATE INDEX "DeviceAsset_deliveryId_idx" ON "DeviceAsset"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAsset_company_serialNumber_key" ON "DeviceAsset"("company", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVisit_number_key" ON "ServiceVisit"("number");

-- CreateIndex
CREATE INDEX "ServiceVisit_company_status_dueDate_idx" ON "ServiceVisit"("company", "status", "dueDate");

-- CreateIndex
CREATE INDEX "ServiceVisit_assetId_idx" ON "ServiceVisit"("assetId");

-- CreateIndex
CREATE INDEX "ErpAuditLog_company_createdAt_idx" ON "ErpAuditLog"("company", "createdAt");

-- CreateIndex
CREATE INDEX "ErpAuditLog_company_entityType_entityId_idx" ON "ErpAuditLog"("company", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "LandedCost" ADD CONSTRAINT "LandedCost_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostHistory" ADD CONSTRAINT "ProductCostHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostHistory" ADD CONSTRAINT "ProductCostHistory_landedCostId_fkey" FOREIGN KEY ("landedCostId") REFERENCES "LandedCost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostHistory" ADD CONSTRAINT "ProductCostHistory_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_relatedDocumentId_fkey" FOREIGN KEY ("relatedDocumentId") REFERENCES "FinanceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAllocation" ADD CONSTRAINT "FinanceAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FinancePayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceAllocation" ADD CONSTRAINT "FinanceAllocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinanceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FinancePayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "AccountingJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingMapping" ADD CONSTRAINT "AccountingMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "BankReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAsset" ADD CONSTRAINT "DeviceAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAsset" ADD CONSTRAINT "DeviceAsset_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAsset" ADD CONSTRAINT "DeviceAsset_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "DeviceAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial controls also apply when records are changed outside the HTTP API.
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_type_check"
  CHECK ("type" IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'));
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_amount_check"
  CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0));
ALTER TABLE "AccountingJournal" ADD CONSTRAINT "AccountingJournal_status_check" CHECK ("status" = 'POSTED');
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_values_check"
  CHECK ("kind" IN ('INVOICE','BILL','CREDIT_MEMO','DEBIT_MEMO') AND "direction" IN ('AR','AP')
    AND "status" IN ('DRAFT','POSTED','VOID') AND "exchangeRate" > 0
    AND "subtotal" >= 0 AND "taxAmount" >= 0 AND "total" = "subtotal" + "taxAmount");
ALTER TABLE "FinancePayment" ADD CONSTRAINT "FinancePayment_values_check"
  CHECK ("direction" IN ('AR','AP') AND "amount" > 0 AND "status" = 'POSTED');
ALTER TABLE "FinanceAllocation" ADD CONSTRAINT "FinanceAllocation_amount_check" CHECK ("amount" > 0);
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_values_check"
  CHECK ("amount" > 0 AND "status" IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','PAID'));
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_status_check" CHECK ("status" IN ('DRAFT','COMPLETED'));
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_amount_check" CHECK ("amount" <> 0);
ALTER TABLE "AccountingMapping" ADD CONSTRAINT "AccountingMapping_kind_check" CHECK ("kind" IN ('ITEM','CUSTOMER','SUPPLIER','ACCOUNT'));
ALTER TABLE "DeviceAsset" ADD CONSTRAINT "DeviceAsset_interval_check" CHECK ("intervalMonths" BETWEEN 1 AND 120);
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_values_check"
  CHECK ("type" IN ('PM','REPAIR') AND "status" IN ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED') AND "cost" >= 0);

CREATE FUNCTION phase3_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Phase 3 audit and posted ledger history cannot be updated or deleted' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "ErpAuditLog_append_only"
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "ErpAuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION phase3_reject_history_mutation();
CREATE TRIGGER "AccountingJournal_immutable"
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "AccountingJournal"
  FOR EACH STATEMENT EXECUTE FUNCTION phase3_reject_history_mutation();
CREATE TRIGGER "LedgerEntry_immutable"
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "LedgerEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION phase3_reject_history_mutation();

-- Deferred until commit, so nested journal/entry inserts are validated together.
CREATE FUNCTION phase3_validate_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id text;
  debit_total numeric;
  credit_total numeric;
  entry_count integer;
BEGIN
  IF TG_TABLE_NAME = 'AccountingJournal' THEN target_id := NEW."id";
  ELSE target_id := NEW."journalId";
  END IF;
  SELECT count(*), coalesce(sum("debit"),0), coalesce(sum("credit"),0)
    INTO entry_count, debit_total, credit_total FROM "LedgerEntry" WHERE "journalId" = target_id;
  IF entry_count < 2 OR debit_total <= 0 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'Posted journal entries must balance exactly' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId"
    JOIN "AccountingJournal" j ON j."id" = e."journalId"
    WHERE e."journalId" = target_id AND a."company" <> j."company") THEN
    RAISE EXCEPTION 'Journal account must belong to the same workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "AccountingJournal_balanced"
  AFTER INSERT ON "AccountingJournal" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION phase3_validate_journal();
CREATE CONSTRAINT TRIGGER "LedgerEntry_balanced"
  AFTER INSERT ON "LedgerEntry" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION phase3_validate_journal();

COMMIT;

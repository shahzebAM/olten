-- A-DB rollback: maintenance/release operation only. Never run automatically.
-- Restores original ID foreign keys. Financial rows and amounts remain intact.
BEGIN;
LOCK TABLE "FinanceAllocation", "FinancePayment", "FinanceDocument" IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE "FinanceAllocation"
  DROP CONSTRAINT "FinanceAllocation_paymentId_company_direction_partyId_fkey",
  DROP CONSTRAINT "FinanceAllocation_documentId_company_direction_partyId_fkey",
  ADD CONSTRAINT "FinanceAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FinancePayment"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FinanceAllocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinanceDocument"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  DROP COLUMN company,
  DROP COLUMN direction,
  DROP COLUMN "partyId";
DROP INDEX "FinancePayment_id_company_direction_partyId_key";
DROP INDEX "FinanceDocument_id_company_direction_partyId_key";
COMMIT;

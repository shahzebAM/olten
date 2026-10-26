-- Approved A-MAP: existing reference links keep their original meaning.
BEGIN;
ALTER TABLE "AccountingMapping" DROP CONSTRAINT "AccountingMapping_kind_check";
ALTER TABLE "AccountingMapping" ADD CONSTRAINT "AccountingMapping_kind_check"
  CHECK (kind IN ('ITEM','CUSTOMER','SUPPLIER','ACCOUNT','POSTING_ROLE'));
COMMIT;

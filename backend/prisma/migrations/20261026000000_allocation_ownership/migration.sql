-- Approved A-DB. Never repair or delete mismatched financial history.
BEGIN;
LOCK TABLE "FinanceAllocation", "FinancePayment", "FinanceDocument" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "FinanceAllocation" a
    JOIN "FinancePayment" p ON p.id = a."paymentId"
    JOIN "FinanceDocument" d ON d.id = a."documentId"
    WHERE (p.company, p.direction, p."partyId")
       IS DISTINCT FROM (d.company, d.direction, d."partyId")
  ) THEN
    RAISE EXCEPTION 'Allocation ownership mismatch: review financial history before this migration';
  END IF;
END $$;

ALTER TABLE "FinanceAllocation"
  ADD COLUMN "company" TEXT,
  ADD COLUMN "direction" TEXT,
  ADD COLUMN "partyId" TEXT;

UPDATE "FinanceAllocation" a
SET company = p.company, direction = p.direction, "partyId" = p."partyId"
FROM "FinancePayment" p WHERE p.id = a."paymentId";

ALTER TABLE "FinanceAllocation"
  ALTER COLUMN "company" SET NOT NULL,
  ALTER COLUMN "direction" SET NOT NULL,
  ALTER COLUMN "partyId" SET NOT NULL;

CREATE UNIQUE INDEX "FinancePayment_id_company_direction_partyId_key"
  ON "FinancePayment" (id, company, direction, "partyId");
CREATE UNIQUE INDEX "FinanceDocument_id_company_direction_partyId_key"
  ON "FinanceDocument" (id, company, direction, "partyId");

ALTER TABLE "FinanceAllocation"
  DROP CONSTRAINT "FinanceAllocation_paymentId_fkey",
  DROP CONSTRAINT "FinanceAllocation_documentId_fkey",
  ADD CONSTRAINT "FinanceAllocation_paymentId_company_direction_partyId_fkey"
    FOREIGN KEY ("paymentId", company, direction, "partyId")
    REFERENCES "FinancePayment" (id, company, direction, "partyId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FinanceAllocation_documentId_company_direction_partyId_fkey"
    FOREIGN KEY ("documentId", company, direction, "partyId")
    REFERENCES "FinanceDocument" (id, company, direction, "partyId")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMIT;

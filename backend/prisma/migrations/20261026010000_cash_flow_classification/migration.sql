-- Approved RPT-2: additive, append-only reporting metadata. No historical amounts change.
BEGIN;
CREATE UNIQUE INDEX "LedgerAccount_id_company_key" ON "LedgerAccount"(id,company);
CREATE UNIQUE INDEX "LedgerEntry_id_accountId_key" ON "LedgerEntry"(id,"accountId");
CREATE TABLE "CashAccountSetting" (
  id TEXT PRIMARY KEY, company TEXT NOT NULL, "accountId" TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version>0), active BOOLEAN NOT NULL,
  actor TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashAccountSetting_accountId_company_fkey" FOREIGN KEY("accountId",company)
    REFERENCES "LedgerAccount"(id,company) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CashAccountSetting_accountId_version_key" ON "CashAccountSetting"("accountId",version);
CREATE INDEX "CashAccountSetting_company_createdAt_idx" ON "CashAccountSetting"(company,"createdAt");
CREATE TABLE "CashFlowClassification" (
  id TEXT PRIMARY KEY, company TEXT NOT NULL, "ledgerEntryId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version>0), operating DECIMAL(18,2) NOT NULL,
  investing DECIMAL(18,2) NOT NULL, financing DECIMAL(18,2) NOT NULL, transfer DECIMAL(18,2) NOT NULL,
  reason TEXT NOT NULL, actor TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashFlowClassification_entry_fkey" FOREIGN KEY("ledgerEntryId","accountId")
    REFERENCES "LedgerEntry"(id,"accountId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CashFlowClassification_account_fkey" FOREIGN KEY("accountId",company)
    REFERENCES "LedgerAccount"(id,company) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CashFlowClassification_sign_check" CHECK (
    (operating>=0 AND investing>=0 AND financing>=0 AND transfer>=0) OR
    (operating<=0 AND investing<=0 AND financing<=0 AND transfer<=0))
);
CREATE UNIQUE INDEX "CashFlowClassification_ledgerEntryId_version_key" ON "CashFlowClassification"("ledgerEntryId",version);
CREATE INDEX "CashFlowClassification_company_createdAt_idx" ON "CashFlowClassification"(company,"createdAt");
CREATE FUNCTION phase3_validate_cash_classification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_amount NUMERIC;
BEGIN
  SELECT debit-credit INTO STRICT entry_amount FROM "LedgerEntry" WHERE id=NEW."ledgerEntryId" AND "accountId"=NEW."accountId";
  IF NEW.operating+NEW.investing+NEW.financing+NEW.transfer <> entry_amount THEN
    RAISE EXCEPTION 'Cash classifications must exactly equal the posted entry amount' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CashFlowClassification_amount_check" BEFORE INSERT ON "CashFlowClassification"
  FOR EACH ROW EXECUTE FUNCTION phase3_validate_cash_classification();
CREATE TRIGGER "CashFlowClassification_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "CashFlowClassification"
  FOR EACH STATEMENT EXECUTE FUNCTION phase3_reject_history_mutation();
CREATE TRIGGER "CashAccountSetting_append_only" BEFORE UPDATE OR DELETE OR TRUNCATE ON "CashAccountSetting"
  FOR EACH STATEMENT EXECUTE FUNCTION phase3_reject_history_mutation();
COMMIT;

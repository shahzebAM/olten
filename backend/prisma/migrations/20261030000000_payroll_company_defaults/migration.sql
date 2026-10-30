BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Additive company rules only. Existing employee profiles and payroll history
-- retain their saved values until an explicit profile/settings edit.
ALTER TABLE "Settings" ADD COLUMN "payrollDefaults" JSONB;
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_payrollDefaults_object_check"
  CHECK ("payrollDefaults" IS NULL OR jsonb_typeof("payrollDefaults") = 'object');
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "Employee" ADD COLUMN "payrollProfile" JSONB;
COMMIT;

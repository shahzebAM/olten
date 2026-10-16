-- Nullable source fields preserve approved break rules on future attendance edits.
-- Existing attendance and finalized payroll values are not recalculated or updated.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "Attendance"
  ADD COLUMN "lunchStart" TEXT,
  ADD COLUMN "lunchEnd" TEXT,
  ADD COLUMN "breakOut" TEXT,
  ADD COLUMN "breakIn" TEXT,
  ADD COLUMN "lunchOverrideMinutes" INTEGER;

-- A snapshot is required because totalHours alone cannot distinguish daily overtime
-- from regular work on additional days. Historical payrolls retain NULL here.
ALTER TABLE "Payroll" ADD COLUMN "attendanceSummary" JSONB;

COMMIT;

# Excel payroll break and currency correction

Date: October 29, 2026 (Asia/Manila).

The user reviewed the formula findings and authorized the fixed-break and rounding corrections with “do it then.” The supplied `Payroll  AUG 26-SEPT 10, 2026.xlsx` is a formula reference. Its attendance, salaries, dates, manual deductions and linked workbooks are not imported. The source workbook remains unchanged.

## Confirmed cause and expected result

The reference daily formula, for example `COMPUTATION TOTAL HRS!E29`, is `(MOD(D29-C29,1)*24)-1`: elapsed hours less one unpaid hour. The former app rule deducted only the worked overlap with the configured lunch window. For a 12:48–19:48 session, those rules deduct 60 and 12 minutes respectively.

The approved minute-only reference case reconciles as follows:

| Calculation | Expected result |
| --- | ---: |
| Recorded elapsed time | 119h 7m |
| Unpaid break deductions | 12h |
| Paid hours | 107h 7m / 107.116666… decimal hours |
| Required paid days / hours | 12 / 96h |
| Overtime | 11h 7m / 667 minutes |
| Daily / hourly rate | ₱755 / ₱94.375 |
| Ordinary overtime rate | ₱117.96875 |
| Overtime pay | ₱1,311.42 |
| Basic / gross pay | ₱9,060 / ₱10,371.42 |
| Entered deductions | ₱981.50 |
| Net pay | ₱9,389.92 |

These are calculation fixtures, not permission to overwrite a saved payroll.

## Implemented rules

- All three attendance/payroll service calculation paths and all three frontend calculation paths explicitly select `APP_ATTENDANCE_POLICY`, currently `FIXED_DAILY`. The standalone calculator retains its selectable legacy `SCHEDULED_OVERLAP` default for existing integrations and regression tests.
- Automatic unpaid time totals one hour per workday. Recognized lunch gaps between split punches already exclude time from recorded work, so only the missing duration is deducted. Duplicate and overlapping punches cannot multiply work or automatic deductions.
- Standalone short workdays with at most 60 eligible minutes have no inferred meal break. Longer workdays use the full fixed hour. This is an explicit exception to the literal workbook subtraction, which could otherwise create negative hours. Recorded duration overrides remain capped at their source session's actual work.
- Explicit break times and duration overrides, including zero, retain their source-session meaning. A zero override on a short extra session cannot cancel a separate full shift's automatic break. Explicitly paid overlapping intervals remain protected. A normal daily automatic allowance is reduced by break time already recorded; separate explicit breaks are not collapsed into one duration.
- A connected midnight continuation shares its original workday's allowance. A separate daytime shift keeps its own allowance. Pre-shift off-clock gaps following a midnight extra are not treated as the daytime lunch break. Cutoff projection occurs after workday allocation, keeping adjacent cutoff totals consistent.
- Currency calculations use decimal rational arithmetic and half-up cent rounding, including negative adjustments. The original salary/divisor is retained for cutoff-based rates. Displayed two-decimal hourly rates do not feed back into pay calculations.
- Gross is rounded after combining full-precision components, matching the reference formula order. When separately rounded display components differ by a cent, new snapshots store an explicit `roundingAdjustment`, shown in the preview and payslip. For example, ₱755 less exact ₱94.375 is ₱660.625, paid as ₱660.63; the displayed ₱94.38 deduction requires a ₱0.01 rounding adjustment.
- The same decimal boundary fixes apply to cent conversion and multiplication by existing withholding-tax rates. Rates, bracket thresholds, contribution eligibility, declaration choices and manually entered contribution amounts are unchanged.
- New snapshots and preview fingerprints include the calculation version `excel-fixed-break-20261029-v1`. Pre-release fingerprints are rejected, requiring a refreshed preview before saving changed pay.

## Preserved records and limits

No schema migration or automatic data backfill is needed. Attendance punches, stored legacy hour caches and existing payroll gross/net/tax/snapshots are not rewritten. Official attendance reads and payroll previews calculate from source punches; stored `Attendance.hours` is not the payroll authority. Tests cover creation and editing of split sessions followed by official aggregate reads.

Saved payslip snapshot selection and legacy estimate helpers are unchanged. The only added print row is conditional on a new snapshot's rounding adjustment. Existing saved records without that field retain their presentation. The summary print/export template remains byte-for-byte equivalent under the existing AST check.

The minute-only entry/display rule remains. Some reference punches contain seconds, so entering different precision can still produce a different total. The workbook also has inconsistent shortage rates, hardcoded tax/contribution inputs, old/external references and formula errors. Those defects are not copied. The previously approved normal-rate shortage rule and the employee's existing overtime basis remain in effect. This change does not certify every payroll policy or statutory contribution amount.

## Verification and release

Meaningful regression coverage includes the reference late start and complete cutoff, multiple/split/overlapping sessions, midnight continuations, adjacent cutoffs, record-level zero/actual-break overrides, paid leave, exact overtime/tax half-cents, original rate divisors, visible rounding reconciliation, stale preview rejection and saved-history preservation. Tests use mocks or pure functions, never a writable production database.

The original `payroll-protected-hashes.json` and pre-redesign `payroll-ui-baseline.json` are retained. A separate `payroll-excel-approval.json` records only this authorized calculator/caller/rounding-row revision. Other protected payroll/profile/attendance UI/schema hashes remain enforced, and independent behavioral tests accompany the new hashes.

Final local verification:

| Check | Result |
| --- | --- |
| Backend complete Jest suite | 52 suites, 1,414 tests passed |
| Frontend Node regression suite | 78 tests passed |
| Backend TypeScript, production and test configurations | Passed |
| Frontend TypeScript project build | Passed |
| Nest production build | Passed |
| Vite production build | Passed; existing large-chunk warning remains |
| Changed calculator, money helper and new tests: ESLint | Passed |
| Existing service lint comparison | 209 to 208 errors, 5 warnings unchanged; no introduced findings |
| Existing PayrollModule lint comparison | 62 errors and 1 warning unchanged; no introduced findings |
| Git diff whitespace check | Passed |

The repository's pre-existing lint findings remain. Comparisons normalize line-ending messages and shifted diagnostic code frames; they do not disable lint rules or edit unrelated source. The initial parallel verification exhausted memory. Final checks ran with bounded heaps and sequential heavy processes; the full passing commands above supersede the failed resource-limited attempts.

The actual updated `EmployeesService.previewPayroll()` was additionally executed against the existing production attendance inside a database-enforced **READ ONLY**, repeatable-read transaction. It returned 12 source sessions, 6,427 paid minutes, 667 overtime minutes, ₱1,311.42 overtime, ₱10,371.42 gross and ₱9,389.92 net with the screenshot's ₱981.50 entered deductions. Source attendance and saved payroll hashes were unchanged. This was a service/data verification, not an authenticated production-browser save. No payroll was posted during verification.

Release target: the existing GitHub `main` auto-deployment for the matching frontend and backend. No database migration is required. Deployment checks are inspected after the Git push; their final status is reported in the chat. The private read-only query and lint evidence stay in the local temporary verification folder and contain no published credentials.

Rollback is a code revert. Preserve saved payrolls and source attendance. Reverting calculation code must not recalculate or delete financial history.

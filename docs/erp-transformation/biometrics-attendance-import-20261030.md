# Biometrics attendance import

## How to use it

1. Open the correct company, then **Payroll → Log Attendance**.
2. In **Import biometrics**, choose the exported `.xls`, `.xlsx` or `.csv` file. The importer recognizes the supplied export even though its `.xls` extension contains an XLSX workbook.
3. Check the displayed **From** and **Through** dates. They initially cover the file's valid dates; narrow the range if needed and select **Preview import** again.
4. Review the matched personnel IDs, dates, time-in/time-out pairs and issue list. Match the file's personnel ID to **Employee ID** in the personnel directory. Names, departments and internal database record numbers are not matching keys. Numeric IDs with leading zeros match only when that normalized ID identifies one employee in the selected company.
5. Select **Import … new sessions**. Only the previewed new sessions are added. Exact existing sessions are skipped; overlaps, existing partial records and leave conflicts remain unchanged for manual review. Changed employee mappings or new conflicts require a fresh preview.
6. Select the employee and the matching cutoff in the attendance grid below. Multiple IN/OUT pairs appear as separate sessions on the same date. Missing IN or OUT stays blank and contributes no paid hours until the missing punch is corrected.
7. Open **Compute Payroll** and refresh its preview to use the saved attendance. Importing does not rewrite existing saved payrolls.

Save or discard attendance-grid drafts before importing. Existing CSV tools remain available for the separate time-in/time-out CSV template.

## Source and pairing rules

Required export columns are **PERSONNEL ID**, **DATE**, **TIME**, and **IN / OUT**. Common employee-ID aliases and compatible sheets are supported. Dates are explicit `YYYY-MM-DD`, `MM-DD-YYYY` or `MM/DD/YYYY`; numeric Excel dates, the 1904 workbook calendar and numeric time cells are supported. Formula cells in the required source columns are rejected.

The import sorts each employee/date's punches by actual source time, retains seconds for that ordering, and stores only `HH:mm` without rounding. Each consecutive IN followed by OUT creates one session. An extra IN leaves its preceding unmatched IN without an OUT; an orphan OUT has a blank IN. Punches on different dates are never combined into a guessed overnight shift.

Repeated punches and identical final minute sessions are deduplicated. Invalid source rows are reported. When an invalid row identifies a particular employee/date, that date's other punches are held for review rather than paired across the invalid row. Unmatched or ambiguous IDs are reported and are not assigned to another person by name or department.

Files are limited to 5 MB, 10,000 punch rows and 2,000 planned sessions per import. Split larger exports by date. Unknown IDs must be corrected in the personnel directory or source export; this feature does not create employees automatically.

## Implementation and verification

`POST /employees/attendance/import-biometrics` uses the existing login, payroll-module and company-access guard. Employee matching is repeated on the server within the selected company. Preview is read-only. Committing takes a company import lock and employee row locks, rechecks the plan, then inserts new sessions in one transaction. Retrying an identical successful import or importing concurrently skips sessions already present. Payroll settings and the existing attendance calculator supply derived hours; the browser cannot submit a claimed hours amount.

No schema migration, payroll formula change, source-workbook modification or historical payroll recalculation is included. Protected calculator/profile/schema baselines and both saved print templates remain intact. The separate unresolved historical Excel Sunday-pay comparison is outside this import feature.

Validation includes pure date/time/ID/pairing tests, API service tests, workbook parsing tests, the full existing frontend/backend suites and TypeScript/build/lint checks. Real Nest/PostgreSQL verification uses only the pre-existing isolated loopback fixture database, confirms preview/no-write behavior, concurrent duplicate imports, ownership boundaries, missing punches, stale previews and preservation of existing attendance/payroll rows. Browser verification runs the actual PayrollModule and Vite styles against that isolated API at desktop and mobile sizes. The provided source workbook is read into memory only for pairing verification; its rows are never inserted into a real company.

Final local results: **58 backend suites / 1,558 tests**, **101 frontend tests**, both TypeScript configurations, Nest/Vite production builds and focused new-code lint checks pass. The legacy service/controller/PayrollModule lint comparison introduces no diagnostics. Desktop (1440 × 900) and mobile (390 × 844) browser runs report no browser errors, external requests or page-level horizontal overflow. The isolated API makes 12 checked requests, including two simultaneous imports returning five new sessions and zero new sessions respectively. Temporary QA services are closed after verification.

Rollback is a code revert. Attendance intentionally imported by users remains ordinary attendance history and must not be deleted as part of a release rollback.

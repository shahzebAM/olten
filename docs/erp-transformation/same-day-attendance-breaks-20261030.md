# Shared automatic breaks for same-day sessions

The user requested applying shared same-day session treatment to other employees. The attendance calculator used by the API and payroll interface now credits time already excluded by internal OUT/IN gaps within the configured shift toward the daily automatic unpaid-break allowance.

## How it works

- All valid sessions for an employee/workday share the existing one-hour automatic allowance. Separate sessions do not each receive another automatic hour.
- An internal off-clock gap wholly inside the scheduled shift counts toward that allowance even if staff took it outside the configured lunch window. Existing configured/recorded meal-gap credit is retained. The two credit sources are combined without double counting.
- An hour already off the clock means no additional automatic hour is deducted. A 30-minute gap leaves only 30 minutes to deduct. Contiguous sessions with no gap still receive one automatic deduction.
- Duplicate and overlapping sessions are unioned before breaks are allocated. Missing punches do not create inferred working spans or break gaps.
- Explicit session break durations and zero-break exceptions retain priority. Actual explicit deductions can exceed one hour; this change caps the automatic allowance, not recorded actual breaks.
- Pre-shift and post-shift extras do not create a new inferred daytime meal gap. A gap crossing a calendar-date boundary is not newly credited, including a 23:59/00:00 continuation boundary. Existing midnight grouping and recorded meal evidence remain unchanged.
- Merely having two sessions does not create a blanket no-break exemption. Single continuous afternoon shifts retain their existing rule. A confirmed session-specific exception, such as the previously approved reference correction, remains effective.

Examples with an 08:30–17:30 shift and a 12:00–13:00 lunch setting:

| Saved sessions | Already off the clock | Additional automatic deduction | Paid time |
| --- | ---: | ---: | ---: |
| 08:30–11:00 and 12:00–17:30 | 60 minutes | 0 minutes | 8h |
| 08:30–11:30 and 12:00–17:30 | 30 minutes | 30 minutes | 8h |
| 08:30–11:00 and 11:00–17:30 | 0 minutes | 60 minutes | 8h |

## Using it

Enter or import each actual IN/OUT pair as its own session. Open Attendance Logs to reload saved totals, then use **Refresh Preview** in Compute Payroll. The same rule applies to every employee using the application's automatic break policy; it has no employee-name whitelist. The interface now explains the shared allowance.

No source punches, wages, company pay profiles or saved payroll records are bulk-edited. Existing saved payroll amounts stay frozen. New/refreshed calculations use version `same-day-breaks-20261030-v3`; payroll previews prepared under the earlier calculation version must be refreshed before saving. There is no schema migration or historical-hours backfill.

## Verification and release

Twelve focused cases cover full/partial/multiple daytime gaps, contiguous and overlapping sessions, duplicate punches, explicit zero/positive overrides, employee/date separation, configured overnight windows and pre/post-shift extras. Existing late-start, short-session, midnight, rest-day and exact-money regressions remain covered.

The complete backend suite passes **59 suites / 1,570 tests**. The frontend suite passes **103 tests**, including shared browser-calculation checks and protected print/schema/profile baselines. TypeScript, production builds and the required lint comparisons pass; legacy lint debt is preserved without new diagnostics. One parallel lint attempt ran out of machine memory, so the successful verification was rerun sequentially with sufficient heap.

A frozen, database-enforced read-only attendance snapshot covers 64 employees and two cutoffs: all 128 hourly comparisons remain unchanged for their existing source punches. All 28 configured payroll previews retain their amounts; 100 legacy preview combinations still require existing working-day input and are not presented as verified payroll amounts. The previously corrected reference gross remains PHP 6,604.17. This is a prevention of the additional split-day cases, not an assertion that every employee already matches an external workbook.

The isolated PostgreSQL/Nest workflow verifies a split-day fixture returns 480 paid minutes, no additional automatic deduction and PHP 500 gross. Saving the new payroll retains that amount; an older saved fixture remains unchanged, and a stale fingerprint is rejected. Desktop and mobile browser runs exercise the actual attendance grid through the isolated API, showing eight paid hours for the separate sessions. Temporary QA services are stopped afterward. No production database writes are performed by this release.

Deploy the matching frontend/backend through the existing GitHub pipeline. Rollback reverts the code while preserving all saved records.

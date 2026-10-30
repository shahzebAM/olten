# Payroll schedule and rest-day correction

Date: 30 October 2026 (Asia/Manila).

Status at commit preparation: implementation and automated validation complete. The guarded profile correction is performed after the matching frontend and backend deployment succeeds. Execution evidence is retained privately in `olten-rest-day-verification-20261030`; this document contains no copied financial history or credentials.

## Authorized scope

The user asked to correct the payroll discrepancy and prevent it recurring. After being told that Excel's separate Sunday amount did not establish a reproducible formula, the user approved the recommended automatic treatment of work on a scheduled rest day: 130% of the ordinary hourly rate for the first eight hours, and 169% for subsequent hours. The approved reference profile is DAILY at PHP 755, with Monday through Saturday as working weekdays and required paid days derived from that calendar.

This change separates actual work on scheduled rest days from the ordinary cutoff calculation, uses the saved working-weekday calendar for classification, and stores the resulting breakdown with each newly saved payroll. It also makes the selected profile and calendar basis clearer in payroll entry. A Sunday configured as an ordinary working day remains ordinary work; the implementation does not treat every Sunday as a rest day.

The correction to the reference employee's profile must be targeted. Existing legitimate fixed-salary arrangements for other employees are not authorized for bulk conversion.

## Cause of the reference discrepancy

Merlita's previous app profile used CUTOFF salary PHP 9,815 and a fixed 14-day divisor. That produced approximately PHP 701.07 per day and PHP 87.63 per hour, and required 112 ordinary hours. Those settings do not represent the approved PHP 755 daily contract and the 12 scheduled working days in this reference cutoff.

The previous calculation also pooled scheduled rest-day work into ordinary cutoff hours. The approved correction uses 96 required ordinary hours, calculates ordinary cutoff overtime separately, and adds the rest-day earnings. Rest-day hours cannot fill a shortage in ordinary scheduled hours. Existing ordinary cutoff overtime and shortage rules otherwise remain in place.

## Independent reference calculation

No individual attendance dates or punch times are included in this record. These are the reference totals used to verify the calculation.

| Item | Expected value |
| --- | ---: |
| Pay basis | DAILY |
| Daily rate | PHP 755.00 |
| Working weekdays | Monday–Saturday |
| Scheduled paid days | 12 |
| Basic salary | PHP 9,060.00 |
| Ordinary required hours | 96h 00m |
| Ordinary paid hours | 104h 19m |
| Ordinary cutoff overtime | 8h 19m |
| Scheduled rest-day paid hours | 11h 26m |
| Rest-day first-eight-hour portion | 8h 00m at 130% |
| Rest-day overtime portion | 3h 26m at 169% |
| All paid attendance hours | 115h 45m |
| Ordinary overtime pay | PHP 981.11 |
| Rest-day first-eight-hour pay | PHP 981.50 |
| Rest-day overtime pay | PHP 547.60 |
| Total rest-day pay | PHP 1,529.10 |
| Gross pay, rounded once from full precision | PHP 11,570.20 |
| Display rounding adjustment | PHP -0.01 |
| Deductions, including PHP 1,000 cash advance | PHP 1,981.50 |
| Net pay | PHP 9,588.70 |

The exact ordinary hourly rate is PHP 755 / 8 = PHP 94.375. Ordinary overtime uses 499 / 60 hours at 125%; the rest-day portions use 480 / 60 hours at 130% and 206 / 60 hours at 169%. Decimal rates retain full precision through gross pay, followed by half-up cent rounding. Individually rounded basic, ordinary overtime, and rest-day pay sum to PHP 11,570.21; the PHP -0.01 adjustment reconciles those displayed components to the correctly rounded combined gross of PHP 11,570.20.

Excel's previously displayed PHP 1,069.43 Sunday amount is not used as a verified formula. Applying the newly approved automatic rest-day rule therefore intentionally produces a different final amount from that historical Excel row. Matching source attendance, pay profiles, deductions, and the approved rules is required for a meaningful comparison.

## Calculation and snapshot review

The service supplies the saved profile's working weekdays to the attendance calculator. Ordinary minutes and actual rest-day work are separated; rest-day work is split at eight hours per workday before source-cutoff projection. Paid leave by itself does not create a rest-day premium. The total attendance figure remains available separately from the ordinary cutoff figure.

New payroll saves are recomputed on the server and retain the calculation breakdown and profile metadata in the saved attendance summary. The calculation version is `scheduled-rest-day-20261029-v2`; it participates in preview fingerprints so previews prepared under the previous rule cannot silently save under the new rule.

Historical saved payrolls and their saved amounts remain preserved. Existing saved-payroll reads do not recalculate their gross or net using today's profile. New rest-day display fields are conditional, so historical snapshots without those fields retain their prior presentation. The change requires no schema migration, historical payroll backfill, or workbook import.

Existing minute-only input and display, fixed daily unpaid-break policy, tax rules, contribution inputs, and other deduction behavior are outside this correction. Manual government or holiday adjustments remain separate from automatic rest-day earnings. This change does not introduce an automatic holiday calendar or establish every employee's legal or contractual pay policy.

## Validation record

The release owner completed the following checks on 30 October 2026. The real-data preview used a read-only database transaction and the actual compiled payroll service with the approved profile simulated in memory. It did not save a payroll or modify attendance.

| Verification | Result / evidence |
| --- | --- |
| Backend TypeScript and lint | Both build/spec TypeScript configurations pass. Calculator, money helper and new test files lint clean. Legacy service lint remains 208 errors / 5 warnings, identical to parent `9cde900`; no new issues. |
| Frontend TypeScript and lint | `tsc -b` passes; profile editor lints clean. Legacy PayrollModule remains 62 errors / 1 warning, identical to the parent; no new issues. |
| Attendance, money and service regressions | Focused calculator/service run: 59 tests pass. |
| Complete backend regression suite | 54 suites / 1,441 tests pass, including historical snapshot preservation, new server-derived saves and stale-preview rejection. |
| Complete frontend regression suite | 84 tests pass, including rendered profile defaults/warnings, shared browser calculation, snapshot/export wiring and protected presentation baselines. |
| Backend and frontend production builds | Nest and Vite builds pass. Existing large-bundle warning remains. |
| Interactive desktop/mobile browser check | Not completed: the browser tool timed out. Server-rendered profile checks and production asset smoke checks are separate from an interactive browser sign-off. |
| Reference arithmetic against actual attendance | Read-only compiled-service preview confirms 12 days, 96 required hours, gross PHP 11,570.20, adjustment PHP -0.01, deductions PHP 1,981.50 and net PHP 9,588.70. |
| Saved payroll and attendance preservation | Before/after hashes within the read-only verification match; the guarded profile update repeats this check in its write transaction. |

Required cases include the independent reference totals above, a rest day that does not fill an ordinary shortage, Sunday configured as a working day, an extra rest day that does not increase scheduled paid days, historical snapshot preservation, new server-derived saves, and stale-preview rejection. Fixtures should remain anonymous and contain no copied employee identities.

## Targeted profile correction procedure

Only the identified reference employee's approved profile may be corrected to DAILY PHP 755, SCHEDULED Monday–Saturday. Profile edits affect new previews and payrolls, not existing saved payrolls.

1. Verify the identified employee/company, current CUTOFF/FIXED profile and legacy salary reference against the reviewed private backup.
2. Lock that employee row in a short transaction and recheck the old profile. Stop on a conflicting profile edit; return without a duplicate write if it already matches the target.
3. Preserve the full original employee row privately. Update only the approved pay profile and modification timestamp. Keep the legacy salary reference, balances and other employee fields unchanged.
4. Append an audit entry identifying this as user-authorized system maintenance, with the old/new profile and release revision; do not impersonate an application user.
5. Compare attendance and saved-payroll hashes before/after in the same transaction, then commit. Preserve the original profile and audit ID for rollback and retry verification.
6. Read back the actual saved profile and run the same read-only service preview. Confirm the expected amounts above. Do not save or replace an existing payroll as part of verification.

## Release procedure and evidence

Push the reviewed change atomically to `main` and `codex/erp-ui-accounting-audit` using the existing GitHub-triggered deployments. Confirm successful Vercel and Railway commit statuses before applying the profile update. Check the production frontend asset for the new breakdown, API health, and rejection of unauthenticated payroll previews. No schema migration is required.

Private execution evidence includes the GitHub deployment statuses, pre-update backup, guarded-update result/audit ID, history hashes, confirmed-profile read-only preview, and production HTTP/asset checks. These execution results are separate from the pre-release automated checks recorded here.

Rollback consists of reverting the calculation/UI commit and, if necessary, restoring the targeted employee profile from the secured prior-profile evidence through a guarded update. Preserve posted payroll records and saved snapshots; do not delete or rewrite financial history to roll back the calculation rule.

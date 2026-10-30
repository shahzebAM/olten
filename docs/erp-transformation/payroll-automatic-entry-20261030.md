# Automatic payroll entry and employee pay setup

Date: 30 October 2026, Asia/Manila.

The user approved moving one-time pay configuration out of Compute Payroll. This release keeps the approved attendance, break, overtime, rest-day, tax and currency calculations unchanged. Employee wages are never inferred from attendance or the number of days in the currently selected cutoff.

## How to use it

1. In **Payroll → Payroll Setup**, review the company's working weekdays and overtime method. Built-in defaults are Monday–Saturday and Excel cutoff balance. Save changes here only when the company rules change. The screen shows how many configured employees use company defaults and how many retain individual rules.
2. In **Personnel Directory → Edit → Employee Details & Pay Setup**, save the employee's agreed daily wage or fixed cutoff salary once. New employee registration uses the same fields and saves employee details and pay setup together in one request.
3. New daily-wage employees use company rules and scheduled cutoff days by default. Choose individual rules under the employee's advanced exceptions only for a different agreed arrangement. A fixed cutoff salary retains its explicit salary divisor and fixed paid-day basis.
4. Open **Compute Payroll** and select the cutoff. The app loads the saved wage and effective rules automatically. The pay summary is read-only; the normal payroll dialog has no wage, working-weekday or overtime-policy editor.
5. Review attendance totals, ordinary and rest-day earnings, deductions and approved adjustments, then save payroll. Use **Open Employee Details** if the agreement needs a change. An employee with no pay setup must complete it there once before saving payroll.

## Compatibility and data handling

Existing saved employee arrangements remain individual rules unless an authorized payroll user explicitly selects company defaults. Changing company settings does not change those individual agreements or anyone's agreed wage. Company inheritance changes only the working-weekday schedule and overtime method; each employee keeps their rate, pay basis and paid-day basis/divisor.

New daily-wage registrations require only the agreed daily wage. Their legacy cutoff-salary reference is zero because it is not used to calculate daily-wage payroll; existing daily-wage employees retain their prior legacy reference. The directory displays the saved daily wage instead of that unused reference. Fixed cutoff salaries continue using their explicit salary and divisor.

The additive migration `20261030000000_payroll_company_defaults` adds nullable `Settings.payrollDefaults` JSON with an object-type check. It does not backfill employee profiles, attendance or payroll. Existing profiles without `rulesSource` keep the previous individual-rule behavior. Company payroll defaults never inherit from another company's Global shift fallback.

Dedicated GET/PATCH `/employees/payroll/defaults` APIs use the existing session, payroll-module and company-ownership guard. They avoid the pre-existing duplicate `/settings` handlers. Existing settings rows update only the selected company's JSON. If a company previously used the Global shift fallback, first saving its rules copies the currently effective shift/lunch times into the new company settings row instead of resetting them. Partial shift updates preserve payroll defaults. Settings edits retain the existing last-writer-wins behavior for authorized users.

For a company-rule employee, preview fingerprints include resolved company defaults. A confirmed payroll save re-reads those defaults in its transaction and rejects an outdated preview. The response returns the raw employee profile separately from the effective rules frozen in the new payroll snapshot. Existing saved payroll amounts and snapshots are not recalculated. Legacy API requests without a fingerprint retain their previous compatibility path; the current UI always supplies the confirmed fingerprint.

## Verification

- Backend production/spec TypeScript configurations pass; frontend TypeScript passes.
- Complete backend suite: **56 suites, 1,509 tests passed**.
- Complete frontend suite: **92 tests passed**; the 22 affected workflow/presentation tests also pass after the final workspace-reset guard.
- New/shared helper and controlled-component files lint clean. Compared with parent `dbe8356`, no new lint issues were introduced. The existing service remains 208 errors/5 warnings, controller 19 errors/2 warnings; PayrollModule improves from 62 errors/1 warning to 56 errors/1 warning.
- Isolated PostgreSQL/Nest HTTP workflow: **21 requests passed**, including authentication/company isolation, invalid defaults, atomic employee creation, automatic wage reuse, stale-preview rejection, individual exceptions, raw profile preservation, frozen saved payroll and partial shift updates. The final shared-shift regression is also covered by unit tests and the isolated workflow.
- Read-only comparison against real data: **64 employees × 2 cutoffs = 128 previews**, with identical existing computed amounts, attendance/pay snapshots and legacy fingerprints before/after the workflow change.
- Both saved print templates, the attendance calculator and money helper remain unchanged. The original payroll-basis formula body is also unchanged. Prior approval fixtures are retained, with a narrowly scoped additional workflow fixture.
- A full PostgreSQL archive was read/decompressed successfully. The new migration passed against a separate local database restored from the existing production schema; original settings values were preserved and the new field started null. Array values were rejected by its object check.

An empty-database replay encountered a pre-existing `ADD CONSTRAINT IF NOT EXISTS` syntax error in the old Phase 1 migration. No published migration was edited. The new additive migration was instead verified against the actual existing schema. This historical bootstrap issue does not require replaying old migrations on the deployed database.

An interactive browser sign-off was unavailable. Rendered component tests cover the wage fields, company-default form and read-only compute summary; they are separate from a signed-in browser check.

## Release and rollback

Before release, take a fresh verified backup, check the 12 existing migration records, apply only the new nullable metadata migration, and compare original Employee, Attendance, Payroll and Settings data. Deploy the matching application through the existing GitHub-triggered Vercel/Railway pipeline and verify commit statuses, health, authentication and frontend asset markers. Private release evidence is retained under `olten-payroll-workflow-20261030`; no credentials, backups or copied employee rows are committed.

The production metadata migration was applied on 30 October after a fresh archive was verified. All 13 migration records are complete; the original Employee, Attendance, Payroll and Settings row counts and digests are unchanged. The new settings field remains null, with no profile conversion or financial backfill.

Rollback should preserve the nullable metadata and all saved financial history. A UI rollback can retain the compatible defaults/profile backend. Once COMPANY-source profiles exist, do not revert to a backend that rejects the new source field; retain compatible profile resolution in the rollback release. Do not drop employee rules or rewrite saved payrolls to roll back this presentation workflow.

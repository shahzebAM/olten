# Re-uploading biometrics to overwrite attendance

1. Open the correct company and **Payroll → Log Attendance → Import biometrics**.
2. Keep **Import behavior → Overwrite matching employee dates** selected.
3. Choose the revised `.xls`, `.xlsx` or `.csv` export. Use a complete export for every employee/date being corrected: old sessions absent from a represented day's new export will be removed.
4. Check the date range, matched employee IDs, missing punches and issues. Open **Review before/after changes** to inspect the old and new sessions and removal count.
5. Select **Apply import**. Choosing a file or viewing the preview alone does not change attendance.
6. Select the employee and cutoff in the grid below, then refresh the payroll preview to calculate using the updated attendance. Existing saved payrolls keep their saved amounts.

Only matched IDs and dates actually represented by valid source rows are considered. Other dates, other employees and other companies remain unchanged. Personnel IDs, multiple sessions and missing-punch handling follow the original import rules; seconds and departments remain ignored for stored punches and matching.

Exact punch matches retain their existing IDs, reasons, shift settings and break overrides. Obsolete unprotected sessions are removed and revised sessions are inserted using the company's shift settings and existing formulas. A changed or obsolete session with an explicit break exception (including zero minutes) is held for manual review, rather than losing or transferring that exception. Saved leave and neighboring overnight conflicts are also held. Invalid source groups never clear a saved day. An incomplete replacement deliberately leaves the missing side blank and contributes zero paid hours until corrected; review that in the preview.

**Add new sessions only** retains the original additive mode. Changing mode or date range invalidates the preview. Exact repeated uploads do not create duplicates. If another user changes source attendance, employee mapping or effective shift settings before Apply, a new preview is required.

## Implementation

The existing authenticated, company-scoped endpoint accepts `mode: replace|append` (omitted mode retains append compatibility). Replacement commits require a UUID `submissionKey` and the preview fingerprint. The actor comes from the authenticated server session, never from uploaded data.

Replacement planning includes exact retained IDs, full before rows, incoming sessions and removed IDs per represented employee/date. Company import locks, ordered employee locks and attendance row locks serialize writes. Manual attendance create, update and delete share the employee locks and re-read source records after waiting. Company ownership is checked inside those transactions.

The transaction writes attendance and an append-only `ErpAuditLog` entry containing before/after rows, actor, scope, source hash and the result. A lost-response retry with the same key returns its recorded result only if source, actor, employee/date scope and resulting attendance still match. Changed content, later edits or changed mappings require a new preview/key. Audit failure rolls back the attendance writes. No schema migration is needed.

Payroll formulas, wage profiles, source files, saved payroll rows and printed payroll snapshots are unchanged. Rollback is a code revert; retain attendance and audit records already intentionally saved by users.

## Verification

- 61 backend suites / 1,616 tests and 113 frontend tests passed, including replacement planning, full-source preview fingerprints, authenticated audit identity, rollback, JSONB-safe retry receipts and manual-writer locking.
- The actual Nest API and PostgreSQL database were exercised only in the identity-checked `payroll_workflow_additive` loopback fixture on port 55438. Thirteen checked requests verified read-only previews, ownership, split sessions, missing punches, protected zero-break exceptions, stale edits and preservation of foreign/absent dates and saved payroll snapshots.
- Two concurrent identical replacement requests produced two successful responses with exactly one audit receipt; one response replayed the saved result. An identical new upload was a no-op.
- The actual import component and API passed browser flows at 1440×900 and 390×844: upload synthetic workbook, inspect old/new punches, apply, then re-upload unchanged. No browser errors or external requests occurred. Temporary services and the test database were stopped after verification. No customer attendance was imported by the agent.
- Backend build/spec TypeScript checks, the Nest production build, frontend TypeScript and Vite production build passed. Focused new-code/test lint is clean. Existing service/controller lint debt gained no diagnostics; formatting-only arrow-parenthesis changes were normalized in that comparison. Payroll calculator/profile/schema and saved print-template regression baselines remain intact.

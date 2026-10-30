# Remove an attendance session

1. Open **Payroll → Log Attendance**, select the employee and cutoff.
2. Use **Remove session** beside the row you want to remove. An unsaved added/typed row is removed locally without a database request.
3. For a saved session, confirm the displayed employee, date and original times. This removes that saved row immediately; it does not require **Save Attendance** afterward. Unsaved changes on that selected row are discarded, while other drafts remain.
4. The grid reloads saved attendance and recalculates totals using the existing attendance rules. Other sessions retain their punches. Removing the last session leaves a blank date row for future entry.

Existing saved payrolls keep their saved amounts. New payroll previews use the updated attendance. A later biometrics import can recreate a removed session if that pair is still present in the uploaded export.

If the saved session has changed, removal is rejected and attendance must be refreshed/reviewed. If the connection is interrupted, the grid checks saved attendance to confirm whether the row was removed. An unconfirmed result blocks further writes until **Check saved status / Refresh** resolves it. It never blindly repeats the deletion.

## Implementation and verification

The existing company-scoped payroll guard protects `DELETE /employees/attendance/:id`. Attendance reads include a source fingerprint over the record ID, employee/date, punches, reason, schedule and break settings; derived hours do not change that fingerprint. The new UI supplies it for deletion, and the server rechecks it after acquiring the shared employee lock. Authenticated deletions append an `ATTENDANCE_SESSION_REMOVED` audit with the prior source and actor in the same transaction; audit failure rolls back deletion. Legacy internal service calls remain compatible. No schema or payroll-formula change is included.

Validation: 96 focused backend tests and 120 frontend tests passed, including stale fingerprints, ownership, audit rollback, unchanged saved payrolls, local draft removal, empty-date fallback and preservation of typed and empty added drafts. Backend/frontend TypeScript, focused lint and production builds passed. The actual API and PostgreSQL were exercised only in the identity-checked loopback test database, with eight API checks. Actual desktop/mobile grid checks covered cancellation, saved and unsaved removal, final-session fallback, lost DELETE replies and failed-refresh recovery. Two network failures were deliberately injected; no unexpected browser errors or external requests occurred. Temporary QA services and the owned database were stopped.

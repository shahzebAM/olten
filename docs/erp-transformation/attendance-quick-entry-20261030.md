# Compact manual attendance entry

In **Payroll → Log Attendance**, select an employee and cutoff. Type a compact time, then press Tab or Enter, or leave the field. Save Attendance still explicitly saves the records.

| Typed value | Time In | Time Out |
| --- | --- | --- |
| `820` or `0820` | 8:20 AM | 8:20 PM |
| `1200` | 12:00 AM | 12:00 PM |
| `820 PM` | 8:20 PM | 8:20 PM |
| `820 AM` | 8:20 AM | 8:20 AM |
| `1820` or `18:20` | 6:20 PM | 6:20 PM |
| `08:20` | 8:20 AM | 8:20 AM |
| `0000` | 12:00 AM | 12:00 AM |

The AM/PM column defaults apply only to compact three/four-digit times with hours 1–12. Explicit AM/PM overrides them. Colon-formatted 24-hour times, hours 13–23 and hour 00 retain their explicit clock meaning. Invalid minutes, incomplete input and mixed forms such as `20:26 PM` stay invalid. Seconds are not accepted.

For additional same-day sessions, enter `120 PM` for a 1:20 PM arrival, for example. Overnight sessions can use `820 PM` in and `820 AM` out. The existing next-day indicator remains available. Enter formats the current field and moves down the same column, including formatting the last field when there is no following row.

Draft validation, duplicate/session detection, native picker values and save payloads use the same field-aware normalizer. Saving before input blur still sends canonical `HH:mm` values. Source-record normalization and backend/import parsing remain unchanged. No database migration, stored attendance rewrite, payroll formula change or saved payroll modification is included.

Verification: targeted parser/payload regressions, actual grid browser checks with synthetic in-memory API records, frontend TypeScript, focused ESLint, full frontend tests and production build. The browser script is `frontend/scripts/verify-attendance-quick-entry.mjs`; set `PLAYWRIGHT_MODULE_DIR` to an existing Playwright installation if necessary. Browser checks never write to a real database.

Results: 110 frontend tests passed; both frontend TypeScript configurations and focused ESLint passed. Production build passed with the existing bundle-size/dynamic-import warnings. Chromium checks passed at 1440×900 and 390×844, including save without blur, last-row Enter, invalid-value rejection, native picker preservation, canonical PATCH and additional sessions. No browser errors or external requests occurred.

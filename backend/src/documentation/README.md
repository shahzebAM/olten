# Document expiry reminders

The existing Prisma `Document` and `DocumentReminder` fields store this workflow. No schema change or new migration is required.

## Upload and reminders

1. Select documents or pictures in AI Docs and choose a lead time in days or calendar months.
2. Each upload goes to Google Drive. Gemini reads the source content and returns a validated expiry date and supporting text. The date saved in the database is also the date returned to the frontend.
3. A readable date with confidence of at least 0.85 creates one reminder automatically. Review and correct the detected date after upload. Ambiguous dates, unreadable files, and analysis failures require manual confirmation before a reminder is activated. A successful analysis with no expiry date creates no reminder.
4. If the calculated reminder date is today or earlier, the reminder is immediately due. Thus a document expiring tomorrow is due immediately with either a two-day or a two-month lead time. A zero-day lead becomes due on the expiry day.
5. Calendar months are subtracted with the day clamped to the destination month's final day (March 31 minus one month is February 28, or February 29 in a leap year).
6. Editing or reanalyzing an expiry updates its reminder. Saving unchanged settings preserves a fulfilled reminder. A changed expiry or a newly confirmed untrusted date activates the new schedule. Deleting a document cascades to its reminders through the existing relation.

Notifications appear in the AI Docs reminder panel. While this module is open it refreshes every 30 seconds and on window focus, and opens the panel when a newly due reminder arrives. Overdue pending reminders are shown when the user next opens the module. Email, SMS, operating-system push, and alerts while the application is closed are not configured.

The backend checks expiry statuses at startup and every minute. Notification reads calculate due status directly, so a custom reminder does not depend on waiting for the cron job. Legacy dated documents without a chosen schedule receive one default reminder, replacing the previous multiple-threshold alerts. A fulfilled user reminder suppresses default reminders.

## Configuration

- Existing `GEMINI_API_KEY` and Google Drive OAuth/folder variables must be configured.
- `GEMINI_EXPIRY_MODEL` optionally selects the expiry model. It falls back to `GEMINI_MODEL`, then `gemini-3.6-flash`.
- `DOCUMENT_EXPIRY_TIMEZONE` optionally selects an IANA timezone; the default is `Asia/Manila`. Expiry and trigger dates are calendar dates stored at UTC midnight, and due checks use this configured timezone.
- Run `npm install` in the backend to install the DOCX readers, then restart the backend and frontend after updating.

Expiry detection supports PDF, DOCX, readable UTF-8 text, JPG, PNG, WebP, HEIC, and HEIF. DOCX extraction includes text, tables, headers, footers, and supported embedded images. Other formats, linked or unreadable images, and unclear scans need PDF export or a manually entered expiry. Analysis supports files up to 50 MB; large PDFs/images use temporary Gemini file uploads, and DOCX extracted content/image payloads have smaller limits.

The current schema stores one expiry per document. If a document contains several active expiry dates, Gemini chooses the earliest explicit expiry; review it against the source. AI extraction cannot guarantee that every scan or date interpretation is correct.

Reanalysis downloads the permanent Google Drive copy because Gemini file references expire after 48 hours. Failed reanalysis preserves the current date and schedule. A date edited while Gemini is working takes priority over the older analysis result. Search indexing failures do not discard a successfully stored document and expiry reminder; the upload review reports the indexing warning separately. DOCX search indexing includes readable text; expiry analysis also reads supported embedded scans.

## API compatibility

`POST /api/docs/upload` accepts the existing multipart fields plus `reminderDays` or the pair `reminderValue`/`reminderUnit` (`days` or `months`). Omitted settings default to 30 days. Lead times must be whole numbers in 0–36500 days or 0–1200 months.

`POST /api/docs/save-reminders` keeps the existing `{ reminders: [...] }` payload and accepts the same lead-time fields. Each row must have a company-owned document ID and a valid `YYYY-MM-DD` expiry date. Numeric database IDs and stored Google Drive IDs are accepted. Invalid rows reject the batch before writes.

`PATCH /api/docs/:id/manual-expiry` accepts `expiryDate` and optional lead-time fields; omission preserves the existing choice. Reanalysis and manual expiry resolve both database and Drive IDs within `x-company`. Directory responses preserve Google Drive file IDs and add `documentId`, expiry metadata, and the current reminder.

Notification status updates require `x-company` and accept `PENDING`, `PROCESSING`, or `FULFILLED`. Reminder responses include `reminderValue`, `reminderUnit`, and `isTriggered` alongside the existing fields.

Regression checks: `npm test -- --runInBand --testPathPatterns=documentation` and `npm run build` in the backend; `npm run build` in the frontend. Tests mock Gemini/Drive/database calls and do not exercise live credentials or upload real documents.

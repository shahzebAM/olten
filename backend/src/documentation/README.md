# Document expiry reminders

The existing Prisma `Document` and `DocumentReminder` fields store this workflow. No schema change or new migration is required.

## Upload and reminders

1. Select documents or pictures in AI Docs. Upload starts immediately, with up to two files processed concurrently, an approximate time remaining for each active file, and a separate reading/saving phase.
2. Each upload goes to Google Drive. Gemini reads the source content and returns a validated expiry date and supporting text. Large native files share one Gemini upload for search indexing and expiry detection; PDF text checks run alongside network processing. Small files retain inline analysis. The date saved in the database is also the date returned to the frontend.
3. After upload, the review modal shows the detected expiry and its source text as read-only. Use the eye icon to compare it with the original, choose days or calendar months, and save to activate the reminder. Closing the review leaves the file stored without an active reminder. Ambiguous dates, unreadable files, and analysis failures require reanalysis or a clearer source. A successful analysis with no expiry date creates no reminder.
4. If the calculated reminder date is today or earlier, the reminder is immediately due. Thus a document expiring tomorrow is due immediately with either a two-day or a two-month lead time. A zero-day lead becomes due on the expiry day.
5. Calendar months are subtracted with the day clamped to the destination month's final day (March 31 minus one month is February 28, or February 29 in a leap year).
6. Reminder timing remains editable; users cannot edit the expiry date. Successful reanalysis can update the date from the source and update its reminder. Saving unchanged settings preserves a fulfilled reminder. Deleting a document cascades to its reminders through the existing relation. The source preview offers Delete for the exact file, with confirmation; Drive failures keep the database document and report the error.

Notifications appear in the AI Docs reminder panel. While this module is open it refreshes every 30 seconds and on window focus. The panel stays closed until the user clicks the bell; new due reminders update the count without opening it. Overdue pending reminders are shown when the user opens the panel. Email, SMS, operating-system push, and alerts while the application is closed are not configured.

Each reminder has an eye icon that opens its exact source document by document/Drive ID, so files with the same name cannot be mixed up. Negative countdowns are displayed as "Expired X days ago"; an expiry today is displayed as "Expires today". The server supplies calendar days remaining using the configured timezone.

The backend checks expiry statuses at startup and every minute. Notification reads calculate due status directly, so a custom reminder does not depend on waiting for the cron job. New frontend uploads store an internal pending-setup status until review is saved; cron and reanalysis preserve it and cannot create a default reminder before confirmation. Legacy dated documents without a chosen schedule receive one default reminder. A fulfilled user reminder suppresses default reminders.

## Configuration

- Existing `GEMINI_API_KEY` and Google Drive OAuth/folder variables must be configured.
- `GEMINI_EXPIRY_MODEL` optionally selects the expiry model. It falls back to `GEMINI_MODEL`, then `gemini-3.6-flash`.
- `DOCUMENT_EXPIRY_TIMEZONE` optionally selects an IANA timezone; the default is `Asia/Manila`. Expiry and trigger dates are calendar dates stored at UTC midnight, and due checks use this configured timezone.
- The PDF text reader requires Node.js 20.16 or newer (or 22.3 or newer on the Node 22 line).
- Run `npm install` in the backend to install the document readers, then deploy or restart the backend and frontend after updating.

Expiry detection supports PDF, DOCX, readable UTF-8 text, JPG, PNG, WebP, HEIC, and HEIF. DOCX extraction includes text, tables, headers, footers, and supported embedded images. Other formats, linked or unreadable images, and unclear scans need PDF export or a clearer source. Analysis supports files up to 50 MB; large PDFs/images reuse their indexed Gemini file during upload, falling back to a temporary file if indexing fails. Reanalysis uses temporary files when needed. DOCX extracted content/image payloads have smaller limits.

The current schema stores one expiry per document. Detection targets the primary document's expiry, including labels such as "Validity of License". Expiries of staff IDs, supporting attachments, and unrelated documents must not replace the primary license/permit expiry. Review the date and its quoted evidence against the source; unclear scans or ambiguous dates cannot activate a reminder until reanalysis obtains a reliable date.

Reanalysis downloads the permanent Google Drive copy because Gemini file references expire after 48 hours. Failed reanalysis preserves the current date and schedule. A reminder confirmed while pending-upload analysis is working takes priority over the older analysis result. Search indexing failures do not discard a successfully stored document and expiry reminder; the upload review reports the indexing warning separately. DOCX search indexing includes readable text; expiry analysis also reads supported embedded scans.

AI search uses only indexed documents whose exact Drive IDs still exist in the current company directory. An empty directory returns an empty answer without consulting Gemini or old cached context. Cache reuse requires the current source set to match, and a source change during analysis requires a fresh search. Deleted files and changed directory contents clear previous displayed answers, including responses still in flight. A Drive failure is reported instead of searching stale sources.

## API compatibility

`POST /api/docs/upload` accepts the existing multipart fields plus `reminderDays` or the pair `reminderValue`/`reminderUnit` (`days` or `months`). The frontend sends `reminderSetup=after-upload` to defer scheduling until review is saved, and responses include `reminderSetupPending`. Older callers without this flag retain automatic scheduling with a default 30-day lead. Lead times must be whole numbers in 0–36500 days or 0–1200 months.

`POST /api/docs/save-reminders` keeps the existing `{ reminders: [...] }` payload and accepts the same lead-time fields. Each row needs a company-owned document ID with a reliable stored expiry. Omit `expiryDate`; the server uses its stored date. Legacy callers may supply the identical date, but a different date is rejected. Numeric database IDs and stored Google Drive IDs are accepted. Invalid rows reject the batch and all changes are rolled back together.

`PATCH /api/docs/:id/manual-expiry` is retained only for compatible reminder timing updates against the same stored expiry; changing the expiry is rejected. Reanalysis and reminder updates resolve both database and Drive IDs within `x-company`. Directory responses preserve Google Drive file IDs and add `documentId`, expiry metadata, and the current reminder.

`DELETE /api/docs/:id` requires `x-company` and verifies the exact company-owned database or Drive ID. Folder deletion also cleans indexed descendants and their reminders. Select only the outermost folders/items when deleting a batch.

Notification status updates require `x-company` and accept `PENDING`, `PROCESSING`, or `FULFILLED`. Reminder responses include `reminderValue`, `reminderUnit`, `isTriggered`, `daysRemaining`, and exact `documentId`/`driveFileId`/`sourceUrl` fields alongside the existing fields.

Regression checks: `npm test -- --runInBand --testPathPatterns=documentation` and `npm run build` in the backend; `npm run build` in the frontend. Tests mock Gemini/Drive/database calls and do not exercise live credentials or upload real documents.

# User manual and Payroll presentation update

Manual edition:26 October2026. Verification finalized:27 October2026 (Asia/Manila).

The user explicitly authorized Payroll's QuickBooks-inspired appearance after the earlier UI freeze. This update changes presentation only: charcoal navigation, green actions/focus states, neutral cards, compact tables/forms and modal toolbars. The payroll route stays in its existing module. All event handlers, API requests, formulas, displayed text and financial expressions remain unchanged. Screen-only CSS excludes the payslip and summary print/export templates.

The complete customer handbook now contains **150 pages,55 chapters and75 actual application screenshots**, with clickable contents/bookmarks, numbered steps, prerequisites, expected results and module handoffs. All51 previous chapter IDs remain; four Books chapters cover complete financial statements, cash designation/classification, Cash Flow exceptions and inventory reconciliation. Posting-role setup, memo retries, account archival, source-account settlement, navigation and troubleshooting were updated. The separate payroll sequence is retained, with refreshed screenshots for its dashboard, directory, registration, pay profile, attendance, computation, payslip, tax and summary screens.

The cover uses the current charcoal/green palette. Four workflow maps show setup/purchasing/receiving, reservation-to-delivery/invoicing/payment, supporting modules/payroll, and accounting review. Repeated one-line continuation pages were corrected before delivery. Loading-state captures were replaced with completed data views, and the landed-cost caption now accurately describes the displayed final record.

The handbook PDF is explicitly marked binary in `.gitattributes` so Git does not treat its ASCII-encoded PDF streams as source text or normalize their line endings. The global PDF text-diff setting was not changed.

## Validation actually performed

| Check | Result |
| --- | --- |
| `frontend: node --test tests/*.test.mjs` | **51 passed**, zero failures/skips. |
| `backend: node --max-old-space-size=4096 node_modules/jest/bin/jest.js --runInBand src/employees` | **8 suites /221 tests passed**. |
| `frontend: npx tsc -b` | Passed. |
| `frontend: npm run build` | Passed; existing bundle-size warning retained. |
| Payroll source fingerprint | Matches immutable pre-redesign commit `8033924cca89a39ac99e7331cad6d4917924fd4f` after excluding only CSS import and JSX class attributes. Newline normalization avoids Windows CRLF false differences. |
| Payslip and report JSX fingerprints | Both match the immutable baseline including their classes/markup. Existing protected calculator/attendance/profile/schema hash tests also pass. No payroll rebaseline was made. |
| Whole frontend ESLint | Still **241 errors /7 warnings**, identical to the preceding report. Payroll remains62 existing errors /1 warning; new presentation-test files add no violations. No suppression or unrelated cleanup was introduced. |
| Browser | Reviewed dashboard, directory, registration, attendance, confirmed calculation preview, pay-profile panel, saved payslip, tax and summary screens. Mobile390px viewport has no document horizontal overflow; the attendance table scrolls within its container. No browser warnings/errors were observed during the checked flow. |
| PDF build | `python docs/customer-guide/build_guide.py`:150 pages,55 chapters,75 unique screenshots, no missing images, non-draft output. Used the bundled Python runtime with ReportLab/Pillow. |
| PDF structural/render QA | Reopened with pypdf/pdfplumber; all150 pages rendered by Poppler;62 bookmarks and212 link annotations. No text/image page-bound violations, blank text pages, missing screenshots or draft placeholders. Contact sheets and affected full pages visually reviewed. |
| Diff review | Only the requested Payroll presentation/tests and manual package are included. The pre-existing `.agents` deletions, root `AGENTS.md`, older drafts and unrelated output are excluded. |

PDF QA scripts/logs and page PNGs are retained locally under `backend/.tmp/user-manual-20261026/` and `backend/.tmp/customer-guide/pdf-qa-delivery-20261026/`; they are not application assets. The final source and capture manifest are portable repository-relative paths. The previous PDF is backed up locally in the task's ignored temporary directory.

## Scope and remaining limitations

Screenshots show synthetic demonstration records. The document-workspace/reminder examples explicitly show the disconnected training environment and explain its connection messages; they do not claim a completed live Drive upload. Live Drive/OAuth, external AI and customer production configuration were not exercised. New accounting screens require the matching app release, as stated in the guide.

No production data, payroll calculation, database schema, migration or financial workflow was changed by this update. Git push is separate from a production release. The earlier approved accounting migrations still require their coordinated release procedure; this update does not apply them.

## Files

See [files.txt](files.txt) for the complete package manifest, including the four Payroll source/test files and the75 referenced screenshots. The PDF is `output/pdf/Olten_ERP_Complete_User_Guide.pdf`. Build sources are `build_guide.py` and `content.json`; `output/pdf/assets/manifest.json` maps each screenshot to its file.

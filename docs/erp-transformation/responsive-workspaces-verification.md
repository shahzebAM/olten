# Responsive workspaces and shared company menus — 27 October 2026

**Production status update, 28 October 2026:** the user authorized the coordinated release and confirmed GitHub-push deployment. The four migrations and matching application release are now live. See [production-release-20261028.md](production-release-20261028.md) for backup verification, preservation checks and deployment evidence. The release-pending statements below describe the original pre-release verification.

## Delivered behavior

- Master Catalog and Customers use compact horizontal module tabs inside the existing ERP shell. Filters and actions wrap; long tables scroll within their own regions. The old catalog mobile translation classes were removed so the tab row remains on screen at phone widths.
- Create Order Slip uses a responsive document header with separate template, customer and document-number fields. Generate P.O. uses compact supplier/source-OS/number fields and contained line-item tables. Existing document handlers, calculations, VAT, numbering, reservations and print/export templates are preserved by the presentation regression tests.
- Executive report buttons, including Stock availability and operational-alert reports, open the existing authorized results in a native modal. CSV/Excel exports remain available. The page behind it is inert; scrolling stays inside the modal. Escape/Close restores focus and page scrolling. A queued React StrictMode cleanup event cannot close a reopened report.
- Super Admins can rename/add/reorder headings, drag module links, move them between headings, restore the defaults and explicitly save a shared company menu. Pointer dragging and keyboard dragging were exercised in the browser. Move buttons and destination selectors are also available, including on phones.
- The menu is presentation data. Existing module/company/ERP-role permissions still determine which links each user sees and which APIs they may call. Ordinary Admins cannot save the shared menu. Existing personal card order is unchanged.
- A version check prevents concurrent menu edits from overwriting each other. A stale save returns 409, retains the draft, refreshes the saved menu and tells the editor to close/reopen for the latest version. Delayed responses from an old login/company cannot replace the current menu.

### Using the menu editor

1. Sign in as **Super Admin** and select a company.
2. Choose **Edit company menu** in the sidebar or workspace home.
3. Edit a heading name, choose **+ Add heading**, and use a handle or move controls to arrange headings/modules. Empty headings can be removed. Each existing module stays assigned once.
4. Choose **Save company menu**. The saved layout is used for that company on subsequent sign-ins. Other users still see only their authorized modules. **Cancel** leaves the saved menu unchanged.

## Report errors and release status

Read-only probes of `https://olten-production.up.railway.app` found the existing `/phase3/books` route (401 with an intentionally invalid bearer token), but these routes returned 404 / Cannot GET:

- `/phase3/books/reports/financial-overview`
- `/phase3/books/reports/profit-loss`
- `/phase3/books/cash-flow/entries`
- `/phase3/books/inventory-reconciliation`

All four already exist in the checked-out backend source and returned **200** against the isolated PostgreSQL/API workspace. This is evidence of a deployed-backend capability mismatch, not an absent controller in current source. The exact deployed Railway commit/branch could not be inspected: `npx --yes @railway/cli status --json` returned **Unauthorized**. The frontend now describes a missing backend feature rather than displaying raw Cannot GET paths. Genuine missing-record errors retain their original explanation.

Vercel CLI inspection identified production project **olten**, team **shahzebams-projects**, with `olten.vercel.app`, `surgicomwarehouse.com` and `www.surgicomwarehouse.com` aliases. No Vercel release or Railway release was manually performed in this task. A Git push is not evidence that the backend was updated.

The configured remote database was also inspected using a connection with `default_transaction_read_only=on` (confirmed by `SHOW transaction_read_only`). Its existing Prisma history is present and ends at `20261021000000_phase3_finance_books_service`. Exactly four repository migrations are pending: allocation ownership, cash-flow classification, posting-role mapping and company navigation. The allocation ownership mismatch query returned **zero**; the existing history-protection function is present. No SQL mutation or backup/restore was performed against that database. This preflight must be rechecked after writers are stopped for release.

Implementation commit **1648a7302399996ec57e3e30907facf1cfa49b92** was pushed and verified against `origin/codex/erp-ui-accounting-audit`. Subsequent live read-only probes still return 404 for the new routes. The local and remote `main` branch were not changed.

### Required production release work

The prior accounting approvals explicitly covered implementation/test databases; production migration remains a separate release action. This task applied the new menu migration only to the verified local test database.

After Railway sign-in and release authorization:

1. Confirm the existing backend project/service/environment and intended Git revision. Inspect its source branch, build/start commands and current deployment. Do not create a replacement production service.
2. Back up the production database and inspect migration history/read-only preflight results. Determine the actual pending migrations. The release includes the three accounting migrations documented in [completion-verification.md](completion-verification.md) and the new `20261027000000_company_navigation` migration. Stop if history requires a baseline or existing finance allocations mismatch; never reset or overwrite data.
3. Coordinate transaction writers while applying the approved accounting migrations and matching backend/client. Required allocation ownership metadata makes the old writers incompatible with the new schema. The menu migration adds only its settings table, positive-version/array checks and Company foreign key.
4. Generate Prisma, build and deploy the matching backend. Release the matching frontend after the backend is ready. Verify authenticated report/menu routes, company access, existing OS/P.O. workflows and migration status on the real target.
5. Preserve all financial rows/history on rollback; follow the existing accounting rollback documentation. Reverting menu code can leave the additive settings table intact, preserving saved preferences.

No production database, payroll amount, journal, stock balance, price, tax rule, or saved document was changed by these checks.

## Checks and results

| Command / check | Result |
| --- | --- |
| Backend `npx prisma validate` | Passed |
| Backend `npx prisma generate` | Passed |
| Backend `npm run typecheck` | Passed |
| Backend `npm run build` | Passed |
| Backend `node --max-old-space-size=4096 node_modules/jest/bin/jest.js --runInBand` | **49 suites / 1,350 tests passed** |
| Focused backend navigation/auth tests | 104 passed; final navigation suite 50 passed |
| Focused backend ESLint, without `--fix` | Passed |
| Frontend `node --test tests/*.test.mjs` | **75 passed, zero skipped** |
| Frontend `npx tsc -b --pretty false` | Passed |
| Frontend `npm run build` | Passed; existing large-bundle warning remains |
| Frontend full ESLint, without `--fix` | **241 errors / 7 warnings**, same pre-existing total. App remains 9 errors / 2 warnings; new editor/navigation and changed report/API files have zero. |
| `git diff --check` | Passed |
| Real PostgreSQL + HTTP harness (`backend/.tmp/ui-20261027/verify-live-api.cjs`) | Menu read/write persistence; 401/403/400; simultaneous creates and edits each produced 200/409; all four reported routes returned 200. |
| Browser, 1280×720 and 390×844 | Catalog, Customers, OS, P.O., report modal and menu editor contained within the viewport. Catalog ledger tab usable on phone; customer selection works in OS; stock modal loads real fixture rows, supports Escape and restores focus. |
| Browser shared-menu workflow | Rename, add heading, move QR link, save, fresh sign-in persistence, pointer module reorder, keyboard heading reorder, stale-save rejection/draft retention, close/reopen conflict recovery and restoring defaults all passed. |

The integration database was explicitly checked as **customer_guide_20261023b**, localhost port **55440**, before applying the menu SQL or writing fixtures. The API used port **3105**, frontend **5175**, synthetic credentials, and disabled external Drive/AI credentials. No production credentials were used in the browser. Initial API startup overlapped a concurrent Nest build and failed because `dist/app.module` was temporarily absent; restarting after the completed build succeeded. A new turn interrupted local services; restarting the isolated cluster completed normal PostgreSQL recovery and tests continued successfully.

The protected schema fixture still uses its original protected hash. Only the explicitly approved finance models, the requested CompanyNavigation model, and the exact optional Company navigation relation are excluded; all other Company/payroll/attendance schema content remains protected.

## Files changed

- Backend: `prisma/schema.prisma`; `prisma/migrations/20261027000000_company_navigation/migration.sql`; `src/auth/company-auth.guard.ts`; `src/companies/companies.controller.ts`; `src/companies/company-navigation.ts`; `src/companies/company-navigation.spec.ts`.
- Frontend shell/menu: `src/App.tsx`; `src/erp.css`; `src/lib/workspaceNavigation.ts`; `src/components/WorkspaceMenuEditor.tsx`; `src/modules/CompanyModule.tsx`.
- Frontend workspaces: `src/modules/MasterInventory.tsx`; `CustomerModule.tsx`; `catalog-customer-workspace.css`; `CreateOSModule.tsx`; `PurchaseOrdersModule.tsx`; `order-entry-workspace.css`; `phase3/InsightsWorkspace.tsx`; `phase3/api.ts`; `phase3/workspace.css`.
- Frontend tests: `tests/catalog-customer-presentation.test.mjs`; `order-entry-presentation.test.mjs`; `phase3-api-errors.test.mjs`; `report-dialog.test.mjs`; `workspace-menu.test.mjs`; `erp-shell.test.mjs`; `fixtures/payroll-protected-hashes.json`.
- This verification document and screenshots in `output/ui-20261027/`: catalog desktop/phone; customers desktop/phone; order-slip desktop; purchase-order desktop/phone; stock-availability modal/phone; menu-editor desktop/phone.

Unrelated existing `.agents` deletions, the untracked AGENTS.md and earlier exploratory output files were preserved and excluded from the change.

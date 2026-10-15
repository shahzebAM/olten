# Phase 1: purchasing and importation

This module adds purchase requisitions, supplier quotation comparison and approval, import files, partial/consolidated shipments, customs clearance, import expenses, goods receipts, QC quarantine, and regulatory document links. The frontend entry is **Importation & Receiving**. Existing suppliers, purchase orders, AI Docs, and Master Inventory remain the integration points. Phase 2 warehouse bins/delivery and Phase 3 landed costing, billing, accounting, and payroll changes are outside this module.

## Workflow

1. Create a purchase requisition (`PR-YYYY-XXXXXX`) using existing active products. Add supplier quotations with currency, PHP exchange rate, MOQ, lead time, payment terms, and optional validity. Submit the request, then approve a selected quotation or reject with a reason.
2. Approval creates one existing purchase order. The original quotation retains its foreign currency and rate; PO unit costs are converted to PHP with six decimal places and line totals rounded to two. Import quotation approval does not automatically apply purchase VAT.
3. Create an import file (`IMP-YYYY-XXXXXX`) and shipments (`SHP-YYYY-XXXXXX`). Shipment lines link to existing PO items, supporting partial shipments and consolidation across POs. Record forwarder/carrier, mode, BL/AWB, container, departure, ETA/revised ETA, and actual arrival. Delay alerts use Manila calendar dates.
4. Record customs broker, entry/declaration references, clearance date, and quantities. Track duties, taxes, brokerage, port handling, storage, demurrage, and other expenses as Estimated, Accrued, Invoiced, or Paid.
5. After arrival, record a goods receipt (`GRN-YYYY-XXXXXX`) within cleared quantities. Allocate physically received units among accepted, rejected, and held quantities; attach batch/expiry, notes, and up to six JPEG/PNG/WebP photos of at most 1 MB each. A completely missing delivery can record zero received units when discrepancy notes or photos are supplied. Reinspect held/rejected lines through QC when appropriate.
6. Open **Master Inventory → Receiving → Place Stock**. Only accepted, unplaced GRN quantities appear. Route them to Master Office or an existing active warehouse; placement atomically updates the receipt balance, stock, and inventory ledger.

PO confirmed quantities represent physical receipt, including accepted, held, and rejected units. They do not represent available inventory. Held/rejected units never enter available stock; accepted units enter only when placed. Previously placed quantities cannot be reallocated by QC. Expired goods cannot be placed. Duplicate or concurrent placements return a conflict instead of adding stock twice. Import-managed POs cannot bypass QC through legacy PO receiving, stock-status updates, or deletion; shipment-linked POs cannot be cancelled.

## Access and API

New endpoints require the existing bearer session and `x-company` header. The server derives the username from the authenticated session.

- `importation: true` plus access to the selected company enables the module. Super Admin retains workspace access.
- Admin and Super Admin can approve/reject; other users also need `importation_approve: true`. Ordinary approvers still need module and company access.
- Existing `inventory: true` or `master_inventory: true` users with company access can use the GRN receiving queue and placement endpoints without full importation access.
- Document linking uses the existing document guard: `ai_docs: true` plus company access, or Super Admin. Importation access alone does not grant document access.

| Endpoint | Purpose |
| --- | --- |
| `GET /importation/overview` | Requisitions, comparisons, shipments, receipts, and master-data choices |
| `POST /importation/requisitions` | Create PR |
| `POST /importation/requisitions/:id/quotations` | Add supplier quotation |
| `POST /importation/requisitions/:id/submit`, `/approve`, `/reject` | PR approval workflow |
| `POST /importation/import-files`, `PATCH /importation/import-files/:id` | Import files |
| `POST /importation/shipments`, `PATCH /importation/shipments/:id` | Shipment creation and progress |
| `PATCH /importation/shipments/:id/clearance` | Clearance and cleared quantities |
| `POST /importation/shipments/:id/expenses`, `PATCH /importation/expenses/:id` | Import expense tracking |
| `POST /importation/shipments/:id/receipts` | Physical receipt and initial QC |
| `PATCH /importation/receipt-lines/:id/qc` | QC reinspection |
| `GET /importation/receiving-queue`, `POST /importation/receipts/:id/place` | Accepted stock placement |
| `GET /api/docs/import-links`, `PATCH /api/docs/:id/import-links` | Optional import-file/shipment/product links and regulatory status |

Document links must belong to the same company; selecting a shipment derives its import file. Regulatory statuses are NOT_REQUESTED, REQUESTED, RECEIVED, UNDER_REVIEW, ACCEPTED, REJECTED, and EXPIRED. An expired document cannot be accepted. Existing Drive, Gemini analysis, expiry tracking, and reminder behavior continue independently.

## Rollout

Apply the additive migration `prisma/migrations/20261015000000_phase1_importation/migration.sql` through the existing release migration process **before starting the updated backend**. It creates new tables and adds optional document links plus a default regulatory status; it does not reset existing tables or update product costs/stock.

The original checkout had only two historical migrations before this change. Live deployment recovered a third, already-recorded migration from Git as described below. These historical migrations may predate the currently deployed schema. Verify the target database's recorded migration history and actual schema against the existing release baseline first. `migrate status` reports history; it does not establish that the schema has no drift. Resolve missing history or drift through the project's reviewed migration/baselining process before deployment. Do not run deploy while that state is unresolved, and do not replay incomplete historical migrations against an existing database.

From `backend`, with the intended release database configured securely:

```powershell
npx prisma validate
npx prisma generate
npx prisma migrate status
```

After migration history and schema compatibility are confirmed, the release migration step is:

```powershell
npx prisma migrate deploy
```

Deploy the corresponding frontend permission controls and screens together. No reset, destructive Prisma flag, or application-database mutation is needed to run the unit checks below.

## Verification

Focused mocked tests, from `backend`:

```powershell
npm test -- --runInBand importation.service.spec.ts importation.validation.spec.ts importation-auth.guard.spec.ts receiving.controller.spec.ts document-import-links.spec.ts purchase-orders-importation.spec.ts auth-http.spec.ts
```

They cover approval/FX conversion, shipment and QC quantity boundaries, tenant/session permissions, date/expiry boundaries, accepted stock placement and rollback, duplicate placement, document links, and legacy receiving protection. `npm test -- --runInBand` runs the existing backend unit suite as well.

The PostgreSQL pipeline suite is `test/importation.e2e-spec.ts`. It writes fixture records and does not reset or delete existing data. Its guard requires `DATABASE_URL` and `PHASE1_TEST_DATABASE_URL` to match, with a `localhost`/`127.0.0.1` host and the exact database name `olten_phase1_test`. The implementation's isolated test database was initialized with the pre-change schema and this additive migration; the historical migrations alone are not assumed to recreate that baseline. Prepare equivalent isolated test infrastructure before rerunning. Never point this suite at an application or production database.

In a dedicated test process with `PHASE1_TEST_DATABASE_URL` already set securely to that local database:

```powershell
$env:DATABASE_URL = $env:PHASE1_TEST_DATABASE_URL
npm run test:e2e -- --runInBand importation.e2e-spec.ts
```

This temporary process configuration must not replace the application's configured database. The suite verifies the real PR → quotation → PO → partial/consolidated shipment → clearance → GRN/QC → master/warehouse placement pipeline and its authorization/failure paths.

## Real database deployment — 2026-10-15

Applied `20261015000000_phase1_importation` to the configured application database at **14:14 Manila time** after the user's explicit deployment request. The migration now includes `BEGIN`/`COMMIT`, a 10-second lock timeout, and a 120-second statement timeout to keep the DDL atomic.

Preflight confirmed that the live schema exactly matched the committed pre-Phase 1 baseline and contained none of the new Phase 1 tables or document-link columns. The database already recorded `20261014041353_phase1_importation`, which a previous Git revert had removed locally. Restored that file's exact bytes from commit `c2c5de3`, verified its SHA-256 against the existing database history, and preserved that history unchanged. Its SQL was not replayed. The deploy command applied only the new migration.

Before deployment, created a custom-format PostgreSQL backup at `backend/.tmp/phase1/real-db-before-phase1.dump`, verified its archive listing and SHA-256, and confirmed Git ignores it. This backup contains private application data and must remain outside source control. Snapshot/count evidence and sanitized release logs are in the same ignored directory.

| Command/check (from `backend`) | Result |
| --- | --- |
| `node .tmp/phase1/real-db-preflight.cjs` | Connected to the configured database; saved a read-only schema/history/count snapshot. |
| `node .tmp/phase1/real-db-prisma-check.cjs baseline` | No difference from the pre-Phase 1 schema. |
| `node .tmp/phase1/real-db-backup.cjs` | `pg_dump --format=custom --lock-wait-timeout=10000` succeeded; `pg_restore --list` verified the archive. Backup size: 358,018 bytes. |
| `node .tmp/phase1/restore-migration-history.cjs` | Recovered the historical migration with exactly the recorded checksum. |
| `node node_modules/prisma/build/index.js validate` | Passed. |
| `node .tmp/phase1/real-db-deploy.cjs` | Guarded `prisma migrate deploy --schema prisma/schema.prisma` succeeded; only `20261015000000_phase1_importation` applied. |
| `node .tmp/phase1/real-db-verify.cjs` | All 12 new tables and four document columns verified; all 28 existing application-table row counts unchanged; historical migration records unchanged; Prisma read queries succeeded. |
| `node .tmp/phase1/real-db-prisma-check.cjs final` | No difference between the live database and current Prisma schema. |
| `node .tmp/phase1/real-db-prisma-check.cjs status` | All four migrations recorded; database schema up to date. |
| `node node_modules/prisma/build/index.js generate` | Prisma Client v6.19.3 generated successfully. |
| `git diff --check` | Passed. |

Existing records include 1,712 products, 64 employees, 368 attendance records, 19 payrolls, 109 order slips, and six documents. All counts were preserved. Existing documents received the new default regulatory status `RECEIVED` with null import/shipment/product links. No fixture data or write tests ran against this database. Application hosting/deployment and the previously documented build/lint issues remain separate from this completed database migration.

Files touched for the real database release: restored `backend/prisma/migrations/20261014041353_phase1_importation/migration.sql`; added transaction/timeout wrapping to `backend/prisma/migrations/20261015000000_phase1_importation/migration.sql`; updated this README. Operational scripts, evidence, and the backup remain in ignored `backend/.tmp/phase1`.

## Git application release — 2026-10-15

The configured deployment branch is `main` on `origin`. Application release uses the existing Git-triggered Railway and Vercel deployments; no hosting configuration or dependencies were changed. The database migration above is already applied.

Release preparation removed two redundant lunch-time defaults from `EmployeesService.getSettings()`. The existing non-null database settings always overwrote those defaults, so removing them preserves the response and resolves the two TS2783 build errors. Added focused regression tests for custom settings, newly created default settings, and read failures; attendance/payroll calculations were unchanged.

Release checks: `backend/npm run build` and `backend/node node_modules/typescript/bin/tsc --noEmit --pretty false` passed; `backend/npm test -- --runInBand` passed 23 suites and 570 tests; `frontend/npm run build` passed with the existing large-chunk warning. The focused settings test also passed ESLint. The previously documented frontend unused declarations and repository-wide lint debt remain. Git staging excludes pre-existing `.agents` deletions, untracked `AGENTS.md`, credentials, environment files, private database backups, and operational logs.

## Implementation verification — 2026-10-15

| Directory | Command/check | Result |
| --- | --- | --- |
| `backend` | `npm test -- --runInBand` | Passed: 22 suites, 567 tests. Before changes: 16 suites, 462 tests passed. |
| `backend` | `npm run test:e2e -- --runInBand importation.e2e-spec.ts` | Passed: 5 tests against isolated PostgreSQL, including concurrent stock placement, transaction rollback, split/consolidated receipts, and concurrent legacy receiving versus shipment allocation. |
| `backend` | `npx prisma validate`; `npx prisma generate` | Passed. |
| `backend` | `npx prisma migrate diff --from-empty --to-schema-datamodel .tmp/phase1/base.prisma --script --output .tmp/phase1/base.sql` | Created the pre-change schema for the isolated database from the committed schema snapshot. |
| `backend` | `npx prisma db execute --file .tmp/phase1/base.sql --schema prisma/schema.prisma`; `npx prisma db execute --file prisma/migrations/20261015000000_phase1_importation/migration.sql --schema prisma/schema.prisma` | Passed against the isolated test database only. |
| `backend` | `npx prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code` | Passed against the isolated test database: no difference detected. |
| `backend` | `npm run build` | Fails on the same two baseline TS2783 payroll errors in `employees.service.ts:513–515` (`lunchStart`/`lunchEnd` overwritten by settings). |
| `backend` | `node node_modules/typescript/bin/tsc --noEmit --pretty false` | Same two baseline payroll errors; new source and tests introduce no TypeScript errors. |
| `backend` | `node --max-old-space-size=4096 node_modules/eslint/bin/eslint.js 'src/importation/**/*.ts' src/documentation/document-import-links.spec.ts src/sales/purchase-orders-importation.spec.ts test/importation.e2e-spec.ts` | Passed with no errors or warnings. |
| `backend` | `node --max-old-space-size=4096 node_modules/eslint/bin/eslint.js '{src,apps,libs,test}/**/*.ts'` | Repository-wide lint fails with 6,289 errors and 165 warnings in existing files. Baseline before changes was 6,798 errors and 163 warnings. The initial default-heap attempt exhausted Node's heap; the 4 GB retry completed. |
| `frontend` | `npm run build` | Passed; existing large-chunk warning remains. |
| `frontend` | `node node_modules/typescript/bin/tsc -b --pretty false` | Same five baseline unused declarations: CompanyModule `ProductQRModule`, CreateOSModule `scannerInput`/`setScannerInput`, PayrollModule `setLunchStart`/`setLunchEnd`. |
| `frontend` | `npm run lint` | Fails with 281 errors and 7 warnings, matching the baseline. |
| `frontend` | `node node_modules/eslint/bin/eslint.js src/modules/ImportationModule.tsx` | Passed. |
| Repository | `git diff --check` | Passed. Pre-existing `.agents` deletions and untracked `AGENTS.md` were preserved. |

Browser verification used the real frontend with an isolated local Nest test server and test database. Verified PR creation, comparison of two quotes, PO generation, import file/shipment creation, logistics and delay alerts, customs clearance/expense entry, GRN/QC, document linking, and existing inventory placement. A browser receipt of 10 units split into 7 accepted, 1 rejected and 2 held; only 7 entered the placement queue, and the stock ledger recorded exactly 7 units in the selected hub with the GRN reference and batch. Live Google Drive/Gemini calls and the browser photo file picker were not exercised; the existing mocked document suite and photo validation tests passed. The configured application database and production deployment were untouched.

### Files changed

Existing files:

```text
backend/prisma/schema.prisma
backend/src/app.controller.ts
backend/src/app.module.ts
backend/src/auth/auth-http.spec.ts
backend/src/documentation/document.controller.ts
backend/src/documentation/document.service.ts
backend/src/employees/employees.service.ts
backend/src/sales/purchase-orders.controller.ts
frontend/src/App.tsx
frontend/src/modules/AiDocsModule.tsx
frontend/src/modules/CompanyModule.tsx
frontend/src/modules/MasterInventory.tsx
frontend/src/modules/PurchaseOrdersModule.tsx
frontend/src/modules/UserControlModule.tsx
```

New files:

```text
backend/prisma/migrations/20261015000000_phase1_importation/migration.sql
backend/prisma/migrations/20261014041353_phase1_importation/migration.sql
backend/src/documentation/document-import-links.spec.ts
backend/src/employees/employees-settings.spec.ts
backend/src/importation/importation-auth.guard.ts
backend/src/importation/importation-auth.guard.spec.ts
backend/src/importation/importation.controller.ts
backend/src/importation/importation.module.ts
backend/src/importation/importation.service.ts
backend/src/importation/importation.service.spec.ts
backend/src/importation/importation.validation.ts
backend/src/importation/importation.validation.spec.ts
backend/src/importation/receiving.controller.ts
backend/src/importation/receiving.controller.spec.ts
backend/src/importation/README.md
backend/src/sales/purchase-orders-importation.spec.ts
backend/test/importation.e2e-spec.ts
frontend/src/modules/ImportationModule.tsx
```

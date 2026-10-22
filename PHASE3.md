# Phase 3 — Finance, Books, Service and Executive Reporting

The ERP now has five workspace cards: **Landed Cost & Finance**, **Books & Reconciliation**, **Medical Device Service**, **Executive Dashboard**, and **Executive AI & Invoice OCR**. Books is internal accounting; there is no external QuickBooks connection.

## Setup and accounting rules

- A Super Admin assigns the ten ERP roles, module access, company access and PHP approval limits in User Control. Existing Admin accounts do not receive financial privileges automatically. Finance approvals require a company limit; Auditor is read-only even when combined with another role.
- Landed costs use explicit supplier-currency exchange rates and value, per-unit weight, per-unit volume or quantity allocation. Final approval records cost history and updates `landedCostReference`. Manual purchase prices and customer tier prices are preserved. Finalization does not itself create a supplier liability; approved bills create the accounting entries.
- Invoices require an active Final Order and confirmed POD quantities. Partial invoices include only newly delivered quantities. Cumulative VAT rounding prevents extra cents across separate deliveries. Document generation and invoice posting do not deduct physical stock again; the existing dispatch rule remains in place.
- The accounting base and payment settlement currency are PHP. Foreign bills retain their original currency, item prices and locked exchange rate. Bills, invoices, authorized memos and allocated payments create balanced journals atomically. Payments record a confirmed payment; they do not initiate a bank transfer.
- Posted documents drive customer/supplier balances and aging. Legacy `Customer.balance` and `Supplier.apBalance` are preserved separately and are not silently imported. Historical balance migration is not automated; a reviewed migration would be needed to include those older balances in the new subledgers. Opening manual journals affect Books, not invoice aging.
- Automatic journals use the documented system accounts. Books mappings are audited reference mappings; they do not override automatic posting accounts. Custom accounts can be used in reviewed manual journals.
- Invoice COGS uses the approved landed reference, falling back to the existing manual cost reference, locked when drafting the invoice. This is reference costing, not FIFO or weighted-average inventory accounting. Financial memos adjust revenue/payables without moving physical stock or reversing COGS automatically.
- Bank CSV imports are previewed, then statement lines are matched to exact signed posted bank entries. Completion requires matching every line and reconciling the closing ledger balance.
- Only verified, POD-delivered serials can be registered for service. Warranty dates, calendar-month maintenance intervals, repairs and parts history are tracked; completed/cancelled visits are immutable.
- Audit records and posted journal history reject update, delete and truncate in PostgreSQL. Financial/service history also prevents deleting its workspace or customer/supplier identity.

## Reports and AI

Eleven role-filtered reports export CSV and Excel: inventory valuation, stock availability, shipment performance, landed costs, sales margin, AR aging, AP aging, customer balances, supplier balances, delivery fulfillment and device service. Query limits and incomplete samples are disclosed. Forecasts use confirmed deliveries over 90 days to project 30 days and identify insufficient history.

AI uses the existing Gemini configuration and only the reports authorized for the requesting role and workspace. OCR additionally requires AI Docs access and a company-owned indexed document. Extracted invoices require staff review and never post themselves. Live Gemini assistant and OCR checks passed with synthetic report/invoice data, and the temporary cloud file was deleted afterward. Response validation, denied-access and failure paths were also tested with mocked provider responses.

## Verification record

- Backend baseline: six importation, fulfillment and authentication suites, **111 tests passed** before implementation.
- Backend full regression: `npm test -- --runInBand`, **43 suites / 1,109 tests passed**. Expected simulated Drive/Gemini failure messages appear in failure-path tests.
- Backend production: `npm run build` passed. The build command now explicitly provides a 4 GB Node heap because the larger generated Prisma types exceeded the default 2 GB build limit. Runtime memory settings are unchanged.
- Frontend: `node node_modules/typescript/bin/tsc -b --pretty false`, `npm run build`, focused new-file ESLint and `node --test tests/phase3-access.test.mjs` passed (**7 permission tests**). Vite retains its existing large-chunk warning.
- Isolated PostgreSQL 18 tests passed: financial postings, partial POD invoices, one-cent VAT/memo boundaries, concurrent payment exclusion, approval limits, tenant isolation, service scheduling, bank reconciliation and immutable journal/audit triggers. Tests used an explicit localhost database, never production.
- Migration validation preserved all 53 original tables/column definitions and representative legacy rows, added 15 empty tables, left existing product cost references null, and matched Prisma's target schema.
- Browser checks passed login → workspace → bill/post → partial payment/aging → invoice/POD → landed-cost approval → bank matching → service → report/Excel export. Browser console was clean. Sales access and cross-company denial were checked through the real local API.
- Live Gemini checks passed for the role-scoped assistant response and supplier invoice extraction, using synthetic data only and no production database writes.
- Existing files have pre-existing lint debt. Added Phase 3 production files are checked separately; unrelated files are not reformatted to hide that debt. Payroll sources were not modified.

Detailed local release evidence and the verified pre-migration database backup are preserved under the ignored `backend/.tmp/phase3/` directory.

The production migration was applied and its schema verified. All 15 new tables were empty, with no financial backfill. The live original-row comparison differed only in `Document`: restoring the backup locally confirmed three records changed only `lastExpiryCheck` / `updatedAt` metadata, with no added/removed documents or changed business fields. All other original-table hashes matched.

## Files changed

- `PHASE3.md`
- `backend/package.json`
- `backend/prisma/migrations/20261021000000_phase3_finance_books_service/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/src/app.controller.ts`
- `backend/src/app.module.ts`
- `backend/src/auth/auth-http.spec.ts`
- `backend/src/documentation/company-deletion.spec.ts`
- `backend/src/documentation/document.service.ts`
- `backend/src/documentation/documentation.module.ts`
- `backend/src/documentation/gemini-phase3.service.spec.ts`
- `backend/src/documentation/gemini.service.ts`
- `backend/src/phase3/books.controller.ts`
- `backend/src/phase3/books.service.spec.ts`
- `backend/src/phase3/books.service.ts`
- `backend/src/phase3/finance.calculations.spec.ts`
- `backend/src/phase3/finance.calculations.ts`
- `backend/src/phase3/finance.controller.ts`
- `backend/src/phase3/finance.service.spec.ts`
- `backend/src/phase3/finance.service.ts`
- `backend/src/phase3/insights.controller.ts`
- `backend/src/phase3/insights.service.spec.ts`
- `backend/src/phase3/insights.service.ts`
- `backend/src/phase3/phase3-auth.guard.spec.ts`
- `backend/src/phase3/phase3-auth.guard.ts`
- `backend/src/phase3/phase3.module.ts`
- `backend/src/phase3/phase3.shared.spec.ts`
- `backend/src/phase3/phase3.shared.ts`
- `backend/src/sales/phase3-party-history.spec.ts`
- `backend/src/sales/purchase-orders.controller.ts`
- `backend/src/sales/sales.controller.ts`
- `frontend/src/App.tsx`
- `frontend/src/lib/phase3Access.ts`
- `frontend/src/modules/CompanyModule.tsx`
- `frontend/src/modules/CustomerModule.tsx`
- `frontend/src/modules/FulfillmentModule.tsx`
- `frontend/src/modules/MasterInventory.tsx`
- `frontend/src/modules/Phase3Module.tsx`
- `frontend/src/modules/UserControlModule.tsx`
- `frontend/src/modules/phase3/BooksWorkspace.tsx`
- `frontend/src/modules/phase3/FinanceWorkspace.tsx`
- `frontend/src/modules/phase3/InsightsWorkspace.tsx`
- `frontend/src/modules/phase3/ProfilePanels.tsx`
- `frontend/src/modules/phase3/api.ts`
- `frontend/src/modules/phase3/shared.tsx`
- `frontend/tests/phase3-access.test.mjs`

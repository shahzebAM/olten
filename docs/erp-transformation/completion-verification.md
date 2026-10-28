# ERP transformation — approved completion and verification

October 26, 2026 · development branch `codex/erp-ui-accounting-audit`.

The approved completion packages A-DB, A-MEM, RPT-1, RPT-2, A-MAP and A-REC are implemented. This extends the UI, authentication and decimal sales-rounding changes in `eff9cc9` and the evidence in `1f49f7d`. All six approvals were received directly in this chat. **No production migration, main-branch merge or production financial-data change was performed.**

The earlier [implementation report](implementation-and-verification.md), [accounting audit](accounting-audit.md) and [security baseline](baseline-and-security.md) remain historical evidence. This report supersedes their pending status for these six packages; it does not erase their original failures. Scope and before/after rules are recorded in [completion approvals](completion-approvals.md) and [reporting proposals](remaining-reporting-proposals.md).

## Delivered behavior

| Package | Result |
| --- | --- |
| A-DB | PostgreSQL composite foreign keys require each payment allocation to share company, AR/AP direction and customer/supplier with both parents. Existing matching rows receive ownership metadata only. Invalid history stops migration. Concurrent parent changes cannot bypass the constraint. |
| A-MEM | An unchanged credit/debit memo retry with the same submission key returns the saved memo. Changed content with that key returns409. A new intentional memo uses a new key. The form retains the key after an unsuccessful unchanged request. |
| RPT-1 | Full posted-ledger P&L, Balance Sheet, Trial Balance, paginated General Ledger, complete XLSX exports and financial overview/trends. Inclusive Manila dates, archived accounts and all accounts/journals are included. The limited legacy workspace overview does not supply statement totals. |
| RPT-2 | Explicit cash/bank designation and versioned operating/investing/financing/internal-transfer classifications. Classification sums must equal the signed entry exactly. Updates/deletes of classification history are rejected. Unclassified entries and unmatched transfers make the statement incomplete, including zero-net exceptions. |
| A-MAP | Named POSTING_ROLE configuration with current standards as defaults. New documents freeze their posting accounts. Payments and memos verify and clear/reverse the original source journal accounts, including mixed old/new control accounts. Generic references and manual journal account selections retain their meanings. |
| A-REC | A Books + Finance read workbench compares separate office and warehouse current reference values with posted Inventory across standard/current/historical mapped controls. Missing or invalid costs and orphan references are exceptions; no automatic correcting journal is created. |

Cash, inventory, AR, input VAT, AP, output VAT and landed-accrual controls must remain distinct. Expense roles may share an account. Selecting BANK_CASH also designates that account for cash reporting; previous cash designations remain until explicitly changed. Posting-role validation blocks invalid/archived/wrong-type configuration. Historical documents without a snapshot must verify against their original standard-account journal; unverifiable history blocks settlement/memos for Finance review.

The costing basis remains the existing landed/manual reference. This work does not introduce FIFO/weighted-average costing, change reservation/dispatch stock timing, capitalize physical receipts automatically, or change tax/payroll formulas. A revenue memo is not a physical stock return or COGS reversal.

## How to use the connected accounting screens

1. A Super Admin grants the existing Books/Finance module permissions and matching ERP responsibilities. Auditor remains read-only. Inventory reconciliation requires both read permissions.
2. In **Books & Reconciliation → Accounts & journals**, initialize standard accounts for a new company or review its existing chart. Add any required asset/liability/revenue/expense accounts. Existing posted history remains protected; only Super Admin can delete/archive accounts under the existing account workflow.
3. In **Account mappings**, choose **POSTING_ROLE**, its source role and a compatible active ledger account. Leave defaults when no remapping is needed. The ITEM/CUSTOMER/SUPPLIER/ACCOUNT options remain references. Review the distinct-control rule before saving.
4. Continue the existing operations chain: catalog/supplier setup → purchasing/import receiving/QC → warehouse stock → OS approval/reservation → FO/PL → dispatch → signed POD. Use the existing Finance delivery-to-invoice action after its required FO/POD checks. Supplier invoices/import expenses use bills. This continuation does not bypass those operational requirements.
5. Review/post the invoice or bill in **Landed Cost & Finance**. The balanced journal is written to Books and the posting-account snapshot stays with the source document. Allocate a receipt/payment to the matching customer/supplier invoices/bills. Balances and aging update from those saved documents and allocations.
6. For an approved memo, select its source, kind, amount and reason. Retry unchanged content after a network failure; the same memo is returned. An intentional additional memo is a new submission. Memos and payments use the source's verified accounts even after a mapping change.
7. In **Books → Financial statements**, apply the inclusive **Asia/Manila** period. Select P&L, Balance Sheet, Trial Balance, General Ledger or Cash Flow. General Ledger requires an account; its pages retain the running balance. **Export complete report** exports the complete filtered result, not just the displayed page, with scope/totals and transfer-exception details where present.
8. In **Cash flow classification**, designate additional cash/bank asset accounts when appropriate. Select a posted cash entry, expand the classification form, choose one category or an exact signed split, and provide the reason. Corrections append a version. Classify both sides of an internal transfer; resolve the listed exceptions before treating Cash Flow as complete. These actions do not change the underlying journal.
9. In **Inventory reconciliation**, review office/warehouse quantities, reference costs, exception rows and Inventory control balance. Known partial values remain visible; an invalid cost/negative balance disables the final comparison. A reference-value difference is evidence to investigate. Only use the existing authorized manual-journal process after Finance has checked receipt/bill timing, opening balances and cost evidence.
10. Use **Bank reconciliation** to match statement transactions to unused ledger entries and complete the checked statement. Review **Audit log** for the existing immutable event history. **Executive overview** shows the ledger financial cards only when Books read access is available; the existing subsidiary AR/AP figures stay separately labelled.

## Independent results

Only the explicitly named local test database `customer_guide_20261023b` on `127.0.0.1:55439` received synthetic fixtures. The integration scripts refuse a different database and do not take their connection from production environment variables. Browser QA used port5175 and a separate API on3105 with cloud credentials disabled. Screenshots contain synthetic test data only.

| Evidence | Observed result |
| --- | --- |
| Standard backend Jest | **48 suites / 1,300 tests passed**, no skips. |
| Independent accounting/security Jest audits | **2 suites / 22 tests passed**. Original audit assertions retained. |
| Frontend Node regression tests | **48 passed**, zero failures/skips. Includes protected payroll hashes and exact large-currency rendering. |
| Real PostgreSQL accounting harness | **22 groups, zero findings**. AR112−40=72; AP112−20=92; TB334 per side; bank20; allocation ownership, both concurrent parent/insert lock orders, memo replay and migration/inverse/preflight. |
| Full-ledger statements/cash flow harness | **12 groups passed**. Revenue1000−COGS400−expense100=profit500. Assets2104=liabilities604+equity/earnings1500. Cash1000+600−300−100=1200; operating change200. More than1000 accounts/100 journals, archived accounts, pagination/export and Manila midnight covered. |
| Posting role harness | **7 groups passed**. Receipt60 clears old AR1300 by40 and new AR1310 by20; original-source memo/AP proportions, invalid configuration and generic/manual account behavior verified. |
| Inventory reconciliation harness | **6 groups passed**. Office5×100=500 + warehouse10×100=1000 versus ledger1200 gives300. Reserved lots are not added twice. Office-only stock, mapped controls, huge exact values, zero/NaN/orphan references, read permissions and unchanged records covered. |
| Real HTTP guard/workflow harness | **61 scenarios passed**. Unauthenticated401, forbidden/foreign access, Auditor read/write separation, report permissions, Books+Finance inventory access and actual memo retry409 behavior covered. |
| Browser | P&L, Balance Sheet, Trial Balance, account-specific GL, Cash Flow, classification selector/form,11 posting roles and inventory screen inspected. Balance Sheet XLSX download independently read:10 rows, assets2104, equity1500, difference0. Desktop and390px breakpoint show no document horizontal overflow. |

The new read-only inventory workbench leaves quantities, purchase cost, landed-cost history and journals unchanged. Classification/version tests likewise assert unchanged underlying journal counts. Payroll calculation/UI files and schema outside the explicitly approved financial models retain their protected baseline hashes from `8eb736acd32922c1d93e4d398da3266eefc9e443`; the fixture was not rebaselined to changed payroll code.

## Commands and check limitations

Commands below ran from `backend` or `frontend` as indicated; exit status/result is recorded, not inferred from compilation alone.

```text
backend: node --max-old-space-size=4096 node_modules/jest/bin/jest.js --runInBand
backend: node --max-old-space-size=4096 node_modules/jest/bin/jest.js --runInBand --testRegex 'legacy-security.audit-spec.ts|accounting.audit-spec.ts'
backend: npm run typecheck
backend: npm run build
backend: node test/erp-transformation/accounting.integration.cjs
backend: node test/erp-transformation/financial-reports.integration.cjs
backend: node test/erp-transformation/posting-mappings.integration.cjs
backend: node test/erp-transformation/inventory-reconciliation.integration.cjs
backend: node test/erp-transformation/legacy-auth.integration.cjs
frontend: node --test tests/*.test.mjs
frontend: npx tsc -b
frontend: npm run build
backend: npx prisma validate
backend: node .tmp/erp-transformation/generate-client-locked.cjs
backend: node --max-old-space-size=4096 node_modules/eslint/bin/eslint.js src/phase3/books.reports.ts src/phase3/books.reports.spec.ts src/phase3/cash-flow.ts src/phase3/inventory-reconciliation.ts src/phase3/posting-accounts.ts src/phase3/books.service.ts src/phase3/books.controller.ts src/phase3/finance.service.ts src/phase3/finance.service.spec.ts src/phase3/phase3.shared.spec.ts src/phase3/accounting.audit-spec.ts
frontend: node --max-old-space-size=4096 node_modules/eslint/bin/eslint.js src/modules/phase3/*.tsx src/modules/Phase3Module.tsx
root: git diff --check
```

All commands above passed. Backend `typecheck` now separately checks the production NodeNext configuration and all test sources under the appropriate bundler context; this resolves the prior cross-tree test configuration issue without editing protected attendance imports. The deliberate invalid-name mock now has the explicit account-field type; assertions are unchanged.

Scoped ESLint passed for every changed Phase3 backend source/spec and all Phase3 frontend TSX/Phase3Module files (existing ESLint executable with4GB heap, no `--fix`). Whole frontend lint still **fails with241 errors/7 warnings**, comprising238 existing source errors and3 in the existing ignored `phase2-sales.local` harness; the changed Phase3 scope has zero errors/warnings. No unrelated lint suppression or bulk cleanup was introduced. Frontend build retains the existing bundle-size warning. Repository-wide backend auto-fixing lint was not run because it would modify unrelated files.

Prisma schema validation and generation passed. Initial generation hit Windows EPERM because the user's already-running backend held the Prisma engine DLL. The local ignored generator wrapper reused that exact byte-identical binary (SHA256 verified) while generating new metadata; it did not stop the user's server or modify dependency source. The first migration-deploy attempt on the pre-existing local fixture database returned P3005 (schema existed without migration history); the three reviewed SQL migrations were then applied only to the verified local test database. No reset or production baseline was attempted. An initial concurrency-test fixture interfered with a later expected AR amount; it was isolated into its own draft fixture, and the original AR assertion now passes unchanged. A PowerShell profile initialization error was bypassed by running the read command without a profile.

Ignored raw logs/reports are under `backend/.tmp/erp-transformation/completion-*`, `accounting-db-audit-report.json` and `legacy-auth-integration-report.json`. They contain no production connection secret and are not shipped as application assets. Coverage was not measured; passing these tests is not a blanket claim of100% accounting or regulatory accuracy.

## Release and rollback

**Release is separate and has not been performed.** Review the branch, obtain the production release authorization, take a verified database backup and run a read-only allocation mismatch preflight. If mismatches exist, stop for Finance review; do not auto-delete/repair history.

For the approved release, schedule a coordinated frontend/backend maintenance window. Stop transaction writers and deploy the matching application/client and database versions together. Apply, in order, migrations `20261026000000_allocation_ownership`, `20261026010000_cash_flow_classification`, and `20261026020000_posting_role_mapping`; regenerate the Prisma client/build with that schema, then start the matching backend and frontend. **This is not a safe rolling migration with old writers:** new allocation ownership fields are required. Resolve existing Prisma migration-history/baseline state using a separately reviewed plan if the release target is not already managed by these migrations. Never reset it.

Use the existing shared production session secret on all backend replicas. This task did not read/change its value. Validate login, authorized reads, one approved transaction and report/ledger reconciliation under the release procedure before reopening writes. Do not auto-create live financial fixtures.

Rollback: disable affected new UI/workflows first. The [reviewed A-DB inverse](allocation-ownership-rollback.sql) restores ID-only allocation foreign keys without deleting rows/amounts; coordinate compatible code/client while writers are stopped. Prefer a forward fix because the inverse weakens ownership enforcement. Preserve all posted journals, memo source keys, frozen account snapshots, cash designation and classification versions. Once mapped postings/classifications exist, do not blindly revert to code that ignores their history or drop their tables: deploy a compatibility fix that preserves original-account clearing and history. Report-only changes can be removed without journals or stock changes. Payroll requires no recalculation or rollback.

## Remaining boundaries

No approved implementation package is awaiting a further business-rule answer. Production migration/deployment is pending its separate release action. Financial reports depend on correct posted source data and opening/closing entries; the Balance Sheet shows accumulated unclosed earnings, not an automated fiscal close. AR/AP aging remains the existing current subsidiary basis, not a newly invented historical subledger snapshot. Inventory reference differences may reflect timing, opening balances or missing capitalization and are not silently corrected. A qualified Philippine accountant must confirm the company's VAT/exempt/zero-rate, withholding, invoice/recordkeeping and period-closing policies. Unsupported refunds, physical returns or tax mechanisms are not fabricated by this task. Drive/OAuth and external AI were disabled during isolated QA and were not revalidated against live external accounts.

## Screen evidence

Synthetic local test data, not production transactions:

- [Financial overview](../../output/erp-completion/statements.jpg)
- [Cash Flow statement](../../output/erp-completion/cash-flow.jpg)
- [Cash classification](../../output/erp-completion/cash-classification.jpg)
- [Posting roles](../../output/erp-completion/account-mappings.jpg)
- [Inventory reconciliation](../../output/erp-completion/inventory-reconciliation.jpg)
- [Mobile inventory report](../../output/erp-completion/mobile-inventory.jpg)

## Changed-file manifest

The reviewed continuation file list is in [completion-files.txt](completion-files.txt). It excludes the user's pre-existing `.agents` deletions, root `AGENTS.md`, older customer guides and unrelated output. The previous implementation's manifest remains in its historical report.

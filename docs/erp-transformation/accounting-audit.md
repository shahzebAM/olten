# Accounting implementation audit

**Follow-up — October 26, 2026:** The approved fixes/reporting work following this audit are documented in [completion verification](completion-verification.md). The original findings and failing baseline evidence below are preserved; their initial status is not the current implementation status.

Audit date: October 25, 2026 (Asia/Manila). Baseline: `8eb736acd32922c1d93e4d398da3266eefc9e443`. Development branch: `codex/erp-ui-accounting-audit`.

This is an implementation audit and isolated test exercise, not an independent accountant's certification or a claim of complete accounting accuracy. The findings below retain the October 25 baseline evidence. On October 26, the user specifically approved A-RND; the approved calculation correction and a technical conflict-response correction are recorded below. No schema, production data or payroll calculation changed.

## Current disposition — October 26, 2026

- **A-RND approved and implemented:** OS/FO creation, explicit OS updates and manual PO creation use existing Prisma Decimal half-up cents. OS/PO browser previews use exact decimal arithmetic. Quantity 1 × unit price 1.005 now persists subtotal **1.01**, VAT **0.12**, total **1.13** through the actual authenticated API and PostgreSQL. No historical documents were automatically recalculated. QT calculations remain unchanged.
- **A-CON corrected as technical error handling:** raw PostgreSQL serialization/deadlock errors (`40001`/`40P01`) return the existing conflict response rather than an uncaught 500. No automatic retry, new posting or calculation rule was added. Three focused tests verify this boundary.
- Final independent accounting unit audit: **10/10 passed**, including the original half-cent assertion. Together with the security audit, **22/22 independent assertions passed**.
- Final isolated PostgreSQL accounting audit: **15 passing groups and 1 failed requirement (A-DB)**. Controlled concurrency responses now pass. Cross-company allocation equality remains enforced by the service but not by a database constraint when bypassing the API; the invalid probe was rolled back and no bad allocation persisted. This failure remains visible and requires an approved migration plan.
- A-INT, A-VAL, A-MEM, A-MAP, A-RPT, A-TAX and A-DB remain open. Financial statements, valuation methods, tax classifications and automatic stock capitalization have not been invented or silently changed.
- Residual precision limit: the OS unit price column stores two decimals and some legacy fields remain Float. Higher-precision unit-price storage and historical recalculation require their own approved policy. Passing the defined cent tests does not remove that schema limitation.

See [implementation and verification](implementation-and-verification.md) for final commands, files and limits. Historical failure descriptions below explain why the approved changes were necessary.

## Actual system and accounting boundary

- React/Vite modules call NestJS APIs. Prisma uses PostgreSQL. Company is generally stored as a company-name string; financial API guards check company/role access. Production database state, credentials and financial records were not queried or changed for this audit.
- Operational flow: catalog/suppliers → requisition/import PO/shipment → receipt and QC → warehouse lots and stock → OS approval/reservation → FO/PL draft delivery → dispatch stock issue → POD → draft Finance invoice → approved posting → allocated payment and optional financial memo. Legacy manual PO receiving and office-stock flows also exist.
- Accounting starts in Phase 3 Finance/Books. A confirmed POD plus active FO is required for invoice drafting. Stock issue is at dispatch; COGS posting occurs later when the Finance invoice is posted. Generating an FO/PL does not post COGS or issue stock. These timing rules were preserved.
- Finance documents, allocations, payments, ledger entries, landed costs and cost references use `Prisma.Decimal`/PostgreSQL numeric columns. Legacy quotation/packing-list/manual PO totals, catalog manual prices, customer balances and supplier running balances still use floating-point storage fields. At baseline OS used decimal storage after JavaScript-number calculations; approved A-RND now calculates OS/FO/manual PO totals with Decimal before persistence. Payroll retains its existing numeric implementation unchanged.
- Inventory costing is **latest approved landed/manual product cost reference**, not FIFO, moving weighted average or historical cost layers. Invoice cost is snapshotted when its draft is created. FEFO is the physical picking order and does not establish a financial costing method.
- `FinanceService.finalizeLandedCost` changes `landedCostReference` and appends cost history; it preserves manual purchase prices/tier prices and creates no accounting journal. Operational inventory receipts, transfers, adjustments and dispatches write `InventoryMovement`, not automatic double-entry journals.
- Automatic invoice, bill, payment and memo journals use fixed standard account codes. `AccountingMapping` stores reference links; it does not select these posting accounts.

## Implemented safeguards inspected

| Area | Actual implementation and evidence |
| --- | --- |
| Balanced journals | `phase3.shared.ts:postJournal` requires 2–200 entries, exactly one positive side per line, positive equal debit and credit totals, exact cents and active company accounts. |
| Idempotent posting | Journal source `(company, sourceKey)` is unique and exact replays compare date, memo, source and entry signatures. Finance invoice posting is status checked; payments use a submission key plus payload verification. Manual journals require a unique reference. |
| Financial approval | Module/ERP-role checks, Auditor read-only rule, Finance/Management approvals, configured company limits and document row locks precede protected posting. |
| Customer invoices | Draft quantity is additional confirmed POD quantity not previously invoiced. Cumulative VAT prevents an extra cent across partial delivery invoices. Product line must have one unambiguous FO source. |
| Supplier bills | Supplier/reference source key prevents duplicate invoice references. Per-line quantity, price, exchange rate, tax fraction and allowed inventory/expense accounts are validated. |
| Payments | Every allocation must be positive, unique and fully allocated; document must be posted, same company, same party/direction, and amount cannot exceed its outstanding balance. Overpayments/unallocated advances are rejected, not carried as an undocumented balance. |
| Memos | Posted invoice/bill required; credit cap includes posted debit memos. Cumulative VAT and AP account proportions preserve cents across multiple credits. Memos are financial adjustments; they do not change physical stock or COGS. |
| Bank reconciliation | Statement arithmetic, signed entry amount, account/company, posted status, date and uniqueness are checked. Completion requires zero difference against both statement closing and total posted ledger closing. It does not implement a separate outstanding-check/deposit-in-transit reconciliation model. |
| History | Phase 3 migration defines append-only audit/journal/ledger triggers, deferred exact-balance and same-company journal-account triggers, restrict FKs and amount/status checks. Their source definition is verified; installed-state testing is reported separately when performed. |
| Read snapshots | Books trial balance and Finance balances use repeatable-read transactions. Posted-only entries are grouped by account. Audit pages use company-scoped cursors. |
| Cancellations/reversals | No Finance document void, payment refund/void or posted-journal reversal endpoint exists in this implementation. UI must not imply these complete workflows exist. Ledger history is append-only. |

## Findings and severity

### Original high finding — A-RND: manual PO cent rounding (now corrected)

`backend/src/sales/purchase-orders.controller.ts:224` uses `Math.round(Number(quantity) * Number(unitCost) * 100) / 100`. The actual controller, exercised by the new audit test, returns **1.00 for quantity 1 × unit cost 1.005**. A separate BigInt rational half-up oracle and the established Phase 3 decimal behavior give **1.01**. With 12% VAT the example is total1.12 vs1.13. This is not a display-only change.

The OS controller uses the same number-based rounding pattern at `order-slips.controller.ts:274`; OS decimal storage does not repair a line total calculated incorrectly before storage. Importation and Phase 3 use decimal arithmetic, so prices at half-cent boundaries can differ by workflow. Exact existing prices containing two decimal places usually avoid this boundary, but that does not establish comprehensive accuracy.

**Evidence:** `accounting.audit-spec.ts`, test “manual PO line rounding agrees with the established decimal half-up boundary” fails with expected1.01, received1.00. The assertion has not been weakened, skipped or removed. No calculation fix was made.

### High — A-INT: operational quantities and Books inventory do not automatically reconcile

Receipt/QC, cycle-count/transfer and dispatch code writes physical stock and inventory movements without a `postJournal` call. Landed-cost finalization only updates references/history. Inventory ledger debits arise from a separately posted bill/manual journal and credits from invoice COGS. Therefore a balanced trial balance is not proof that physical inventory value equals the Books account.

**Example:** receive10 units at reference cost100 but do not post a supplier bill or opening journal. Warehouse reference report can show1,000 while Books inventory is0. An invoice posted before the appropriate capitalization could produce a credit/negative Inventory ledger balance even when physical quantity never goes negative. This is a workflow/accounting-coverage gap, not evidence that existing physical stock rules should be changed automatically.

### Medium/High — A-VAL: inventory valuation scope and historical basis are limited

`insights.service.ts:691–802` starts from `WarehouseStock.groupBy`, then multiplies current quantity by `landedCostReference` or manual `purchasePrice`. It does not include `Product.currentStock` office balances and does not establish a historical cutoff valuation. A new landed reference can revalue the entire displayed warehouse quantity while prior invoice COGS remains frozen.

**Example:** warehouse10 ×100 gives1,000; separate office5 ×100 is not in that report. Confirm whether intended report scope is warehouse-only or all pools before changing it. This report must remain labelled **reference valuation**, not audited inventory or FIFO cost.

### Medium — A-MEM: memo submissions lack a replay key

`FinanceService.createMemo` creates a new memo and journal for each accepted request; its input has no submission key and no exact replay lookup. Journal source keys prevent a single memo's posting from being repeated, but do not prevent two new memos from being created by a retransmitted HTTP request. The credit cap limits total credits but cannot distinguish an accidental retry from a legitimate second allowance of the same amount.

**Example:** posted invoice112; submit credit memo11.20 twice with the same reason. Both can be accepted as separate documents, reducing balance to89.60 instead of the intended100.80. This is a risk identified from the implementation; a real network-retry production incident was not claimed.

### Medium — A-MAP: reference mappings are not automatic posting configuration

`BooksService.setMapping` validates and saves company-scoped source/account links. `FinanceService.documentLines`, payment postings and COGS postings select hard-coded account codes instead of reading those mappings. An operator changing a reference mapping should not expect automatic invoice/payment postings to move to another bank/revenue account.

**Example:** mapping a customer or bank reference to a custom bank1010 does not change a customer payment debit from standard1000 to1010. A mapping-driven posting strategy and account classifications need specific approval before implementation.

### Medium — A-RPT: requested financial statements are not complete supported reports

Books exposes current debit/credit account totals and recent journals, plus reconciliation. Existing management reports include operational stock, reference valuation, posted sales margin and AR/AP balances. There is no approved fiscal-period P&L, retained-earnings/closing model, complete Balance Sheet, cash-flow classification engine or historical as-of trial balance/report API. The UI should identify these as unsupported backend/report features, rather than synthesizing net profit from invoice margin or presenting fabricated zero balances.

**Example:** sales subtotal100 minus COGS50 is margin50; service/import expense20 would make a simplified profit30, but the existing sales-margin report does not subtract it. Calling that existing50 “net profit” would be incorrect. Opening balances and retained earnings must be reconciled before a Balance Sheet equation is meaningful.

### Medium — A-TAX: tax classification and statutory invoice scope need accountant confirmation

The sales path has document-level `vatApplied`/`vatRate`; bill lines accept a tax fraction but do not distinguish legal VAT-exempt vs zero-rated classification. Unit prices are treated as tax-exclusive; a separate inclusive-price mode is not implemented. Discount/tax-base policy, sales withholding/EWT allocations and BIR invoice/e-invoice metadata/export are not complete supported features. Customer/supplier TIN fields exist, but their mere presence does not prove every issued invoice contains the required seller/buyer information or certification details.

The audit does **not** assume every product/customer/transaction is VATable, nor determine the company's registration category or tax obligations. No VAT, withholding or payroll tax rule was changed.

### Low/Medium — existing report limits and separate legacy balances

Books account/mapping lists cap at1,000 and recent journals at100; management reports cap at1,000 and identify truncation. Finance balances reject a query beyond5,000 rather than silently presenting a complete balance. Phase 3 AR/AP reports exclude legacy `Customer.balance`/`Supplier.apBalance` opening balances. Use narrow, evidenced reports or accountant-approved opening journals; do not silently add legacy balances and risk double counting.

### Original medium finding — A-CON: raw concurrency error response (now corrected)

An actual four-way simultaneous `FinanceService.postDocument` test against the isolated PostgreSQL database produced one successful invoice posting and three raw Prisma `P2010` errors with SQLSTATE40001. The handler translates `P2034`/`P2002` only; a raw `FOR UPDATE` serialization failure escapes the intended controlled409 path. The journal remained unique and balanced, so this test found an error-handling defect rather than duplicate postings. Returning the same existing409 conflict for raw40001 (without retrying/reposting/changing state) is a candidate safe technical correction; no such production-code change was made by this audit.

### High defense-in-depth gap — A-DB: allocation tenant equality relies on API validation

The Finance API validates that allocated payment/document parties, direction and company match. A direct database insert linking a new synthetic other-company payment to the main synthetic audit invoice was nevertheless accepted inside a deliberately rolled-back transaction. Existing FKs verify each ID exists, but do not enforce that both parents have the same company. The test immediately forced rollback and confirmed zero persisted bad allocations. This is an isolated installed-schema observation, not a claim that production has such records. Database constraint changes require explicit approval and a historical-data assessment.

## Independent automated audit tests

File: `backend/src/phase3/accounting.audit-spec.ts`. Naming deliberately separates approval-pending diagnostics from the unchanged standard regression test pattern. It is an executable test suite, not skipped tests.

Command from `D:\olten\backend`:

```powershell
node --max-old-space-size=4096 node_modules/jest/bin/jest.js --runInBand --testRegex accounting.audit-spec.ts
```

Initial baseline result: **10 tests:9 passed,1 failed**, exit1. The failure was A-RND above. After the specifically approved correction the same audit passes **10/10**. Passing cases verify:

1. 240 FX, quantity and VAT combinations against independent BigInt fixed-point arithmetic (no production Decimal/rounding helper in the oracle).
2. Hand-established landed-cost conversion/allocation including a one-cent equal-weight tie.
3. Posted-only memo/payment outstanding balance:1,120−112+56−500=564, ignoring draft/void entries.
4. Actual Finance posting plus actual `postJournal`: invoice100+VAT12 and cost50; exact expected account entries; two receipts40+72; exact-replay idempotency; trial balance274 debits=274 credits; AR0 and cash112. The independent transaction equation is assets62=VAT liability12+profit50 for this limited synthetic transaction set.
5. Overpayment rejection and changed submission-key rejection before additional accounting entries.
6. Mixed-account bill100+VAT12 with inventory70/expense30; supplier payment20; payable92.
7. Rejection of a one-cent journal imbalance without journal/audit creation.
8. Three partial financial credits0.33+0.33+0.34 conserve original VAT0.11 (tax0.04+0.03+0.04) and balance0.
9. Manila midnight and aging boundaries0/1/30/31/60/61/90/91 into independently expected buckets.

These service tests use an in-memory database double and actual production Finance/Books/journal methods. They independently recalculate amounts; they do **not** prove PostgreSQL transaction rollback/concurrency/trigger installation. Existing relevant regression suites and any separately executed real-PostgreSQL tests are listed by the main verification report, not inferred from this test.

## Actual PostgreSQL integration audit

Command from the backend: `node .tmp/erp-transformation/accounting-db-audit.cjs`.

The script uses an explicit loopback connection to `customer_guide_20261023b` on127.0.0.1:55439, verifies `current_database()` before writing, ignores production `DATABASE_URL`, and creates only new `Accounting Audit <timestamp>` companies. Existing demo records are not changed. Synthetic draft source documents are prepared directly for posting tests; this does not claim to exercise the entire delivery→POD→invoice drafting chain. The parent workflow owns that separate regression evidence.

Initial complete run before the technical conflict correction: **15 passing groups,4 failed assertions representing2 root causes**, exit1. The final rerun has **15 passing groups and1 failed requirement (A-DB)**; A-CON now passes. Report: `backend/.tmp/erp-transformation/accounting-db-audit-report.json`.

- Five expected Phase3 integrity triggers were installed and enabled; the two balance triggers were deferred until commit.
- Four simultaneous invoice-post requests and a subsequent repeat produced exactly one posted invoice journal. One succeeded; three losing requests exposed A-CON above. Payment-key concurrent replay created one payment and one payment journal, with correct changed-payload and overpayment rejection.
- Actual persisted AR source amount112−allocated receipt40=72; AP bill70 inventory+30 expense+12VAT−payment20=92.
- Independent source-to-ledger expectations matched account balances: cash20, inventory20, AR72, inputVAT12, AP−92, outputVAT−12, revenue−100, import expense30, COGS50. Total debits334=credits334; difference0. Independent limited-set equation: assets124=liabilities104+profit20.
- A real statement with opening0, receipt40 and supplier payment−20 matched persisted signed ledger entries and completed at closing20.
- The database rejected a balanced journal containing a foreign-company account and rolled back the transaction; it also rejected a one-cent-unbalanced journal at commit and rolled back. Service company isolation and journal foreign keys rejected invalid references.
- Actual updates to new audit-only journal, entry and audit-log rows were rejected by append-only triggers. No TRUNCATE or destructive table-wide operation was attempted.
- The cross-company allocation probe confirmed A-DB, forced rollback and independently confirmed no invalid allocation persisted.

These are controlled local evidence, not a production database audit or an accountant's signoff. Earlier failed runs stopped at the concurrency transport defect before completing later checks; the final report contains the complete run and retains all unresolved failures.

## Current primary Philippine sources checked

The sources below were checked on October25,2026. Their applicability to each legal entity/branch must be confirmed against its BIR registration and accountant's advice.

- [BIR RR7-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%207-%202024.pdf) and [BIR RMC77-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024.pdf): invoice requirements distinguish VATable, VAT-exempt and zero-rated sales; mixed transactions require appropriate breakdowns or separate labelled invoices. Review the ERP's document classification/presentation before statutory use.
- [BIR RR6-2026](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%206-2026.pdf), dated August25,2026, adds applicable creditable withholding tax as a separate invoice item. Verify applicability and the company's approved invoice layout; the sales Finance implementation does not yet model a separate sales-withholding amount.
- [BIR RR11-2025](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2011-2025.pdf) defines requirements for covered electronic-invoicing systems. A PDF/printed ERP document alone does not establish electronic-invoice qualification.
- [BIR RR26-2025](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2026-2025.pdf) extends the specified covered taxpayers' electronic-invoice issuance compliance period to December31,2026. Confirm entity coverage, CAS/CBA registration and subsequent guidance with the accountant/RDO.
- BIR's [2026 memorandum circular index](https://www.bir.gov.ph/2026-Revenue-Memorandum-Circulars?label=2026&type=PAGE) lists RMC98-2026 on electronic invoices (September22,2026). The index entry was identified; its full official PDF was not retrievable by the browsing tool, so this report does not assert its detailed permit/certification procedures.

This source review flags compatibility work; it is not a compliance opinion, implementation approval, or a reason to change tax formulas automatically. No statutory financial statement assurance was performed.

## Specific proposed logic changes awaiting approval

A-RND below has been approved and implemented as recorded above; its original proposal is retained for traceability. Every other item in this table remains unimplemented. Approval must identify the specific item; general authorization for visual redesign does not authorize these changes.

| ID / module | Existing logic and issue | Specific proposed change | Before → after example | Impact | Verification and rollback |
| --- | --- | --- | --- | --- | --- |
| A-RND / manual PO and OS money | Binary-number multiplication then `Math.round`; verified half-cent discrepancy | Adopt decimal half-up line/subtotal/VAT calculation consistently in the approved sales/procurement endpoints only. Preserve two-decimal storage and all saved documents; do not touch payroll/shared payroll utilities. Confirm fractional-unit-price policy first. | 1×1.005 →1.00 currently; proposed1.01. With12% VAT total1.12→1.13. | New documents, VAT totals, linked FO invoices; old documents unchanged | Run the failing audit plus cent boundaries, negative/invalid-price validation, OS/FO/import PO/VAT regression and isolated DB round trip. Roll back the code commit; do not recalculate or delete posted data. **Do you approve this specific logic change? YES or NO?** |
| A-MEM / Finance memos | Every accepted call creates a new memo; retries have no replay key | Require a client-generated submission key and use existing company/source-key uniqueness plus exact-payload comparison, retaining distinct intentional memos under different keys. | Invoice112 and repeated11.20 intended memo currently can yield89.60; proposed repeated same-key response remains100.80 | Memo UI/API, duplicate handling; no calculation or existing data change | Sequential/concurrent replay and changed-payload conflicts, separate intentional memo keys, credit caps and VAT conservation. Revert code; retain recorded source keys/history. **Do you approve this specific logic change? YES or NO?** |
| A-VAL / inventory report | Warehouse-only current reference valuation | Confirm warehouse-only vs office+warehouse reporting scope; if full scope approved, expose separate pools and a clearly identified combined reference total. Do not introduce FIFO/weighted average. | Warehouse10×100=1,000; adding separate office5 gives combined1,500 if approved | Reporting totals only; no stock movement | Independent quantity ledger reconciliation per pool, zero/missing-cost and tenant cases. Revert report change; no stored values altered. **Do you approve this specific logic change? YES or NO?** |
| A-INT / inventory and landed accounting | Physical movements and cost references do not automatically post journal capitalization/accruals | Design an accountant-approved event-to-account policy and cutover/opening-balance plan; only then add idempotent journals for explicitly approved events. Preserve the current dispatch/receipt points. | Receipt10×100 currently report1,000/Books0; proposed approved receipt capitalization yields report1,000/Books1,000 with an approved offset | Bills, import expenses, landed costs, COGS, returns, opening balances and duplicate-cost risk | Full rollforward, receipt/bill/accrual matching, partial receipts, reversals, duplicate/concurrent events and staged cutover. Feature-gated code rollback; correct posted mistakes through approved reversal journals, never deletion. **Do you approve this specific logic change? YES or NO?** |
| A-MAP / posting account strategy | Stored reference mappings do not affect fixed-code journals | Confirm supported mapping kinds and fallback strategy; apply approved mapping lookup consistently to automatic postings with type validation | Mapped bank1010 currently still posts Dr1000; proposed Dr1010 for the approved mapped scenario | Finance postings, bank reconciliation and historical comparability | Missing/inactive/foreign/type-invalid mappings, posted history unchanged, exact balance and rollback to fixed defaults. **Do you approve this specific logic change? YES or NO?** |
| A-RPT / financial statements | No approved full fiscal-period P&L/Balance Sheet/cash-flow reporting model | Approve statement account classifications, opening/closing balances, date basis and cash-flow categories before implementing read-only financial report calculations | Existing margin50 cannot be called net profit; after approved expense20 classification, simplified profit30 | Report definitions and accountant interpretation; no new posting by this proposal | Independently construct source-ledger expected statements and closing reconciliation; date/tenant/truncation tests. Roll back report/API code only. **Do you approve this specific logic change? YES or NO?** |
| A-TAX / classifications and invoicing | Document VAT flag/rate and tax-exclusive prices; no complete exempt/zero-rated/inclusive/EWT/e-invoice model | Obtain entity-specific accountant/RDO-approved rules and invoice requirements, then request a separate exact implementation proposal per rule; do not assume a rate or registration | Existing non-VAT flag cannot distinguish exempt vs zero-rated; approved schema could label each accurately without applying VAT to all sales | Sales, bills, customer profiles, statutory presentation; payroll explicitly excluded | Accountant-supplied worked cases for each tax class, inclusive/exclusive bases, withholding and official exports; migration/cutover plan if approved. Code rollback, no automatic historical recalculation. **Do you approve this specific logic change? YES or NO?** |
| A-DB / financial tenant constraints | FinanceAllocation FKs allow parents from different companies when bypassing the validated service | Add approved database-level equality protection for allocation parent companies, with historical validation and compatible tenant-key/immutability strategy | Direct payment-companyB→invoice-companyA1.00 can currently insert; proposed rejects and rolls back before changing either balance | Schema/migrations and direct SQL/import tools; normal valid service flow unchanged | Audit existing rows read-only before migration; same-company, cross-company, parent-company updates, FK, concurrency and rollback tests on separate DB. Revert migration/code under approved plan; never auto-delete financial history. **Do you approve this specific logic change? YES or NO?** |

## Required independent checks before an accuracy claim

Reconcile a representative cutoff's posted source invoices/bills/memos/payments to bank statements, AR/AP subsidiary ledgers, opening balances, actual physical stock and Inventory/COGS; confirm actual installed DB triggers; validate company tax registrations and approved invoice/e-invoice formats; have a qualified Philippine accountant approve report/costing/tax policies. Automated arithmetic tests are evidence for their defined scenarios only.

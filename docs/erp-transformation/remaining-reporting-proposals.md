# Remaining accounting proposals: reports and posting mappings

**Disposition — October 26, 2026:** RPT-1, RPT-2 and A-MAP were explicitly approved in this chat and implemented/tested on the development branch. Production migration/release was not performed. See [completion verification](completion-verification.md). The original design-only text below records the proposals at the time of approval.

Prepared October26,2026 (Asia/Manila), from the current repository. Status: **design only; no report formula, posting behavior, schema, payroll or financial record changed**. The previously approved rounding/conflict/security changes are outside this proposal and are not being proposed again.

The master request requires explicit approval before new financial calculations or posting rules. The packages below are deliberately separate: read-only reporting approval does not authorize remapping journal accounts, and mapping approval does not authorize changing amounts, stock timing, tax or costing methods.

## Existing implementation verified

- `BooksController` exposes current `/phase3/books`, unmatched ledger-entry pagination, account setup, manual journals, reference mappings and reconciliation. There are no statement/date-filter endpoints.
- `BooksService.overview` groups **all posted ledger entries to date** and returns account debit/credit totals. Accounts are limited to1,000 and journals to100; this overview response must not be reused as a complete financial report dataset.
- `LedgerAccount` has company, code, name, type and active status; five types are ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE. There is no current/non-current, cash-equivalent, retained-earnings or cash-flow classification field.
- `AccountingJournal` has immutable date, sourceType/sourceId/sourceKey, memo and posted entries. There is no implemented fiscal-year close workflow, closing-entry marker or cash-flow classification. Source posting dates may differ from record creation timestamps.
- Existing automatic Finance journal accounts are selected with fixed standard codes in `FinanceService.documentLines`, COGS posting and payment posting. `postJournal` validates exact cents and resolves supplied account codes. Manual journals intentionally specify their own codes.
- `AccountingMapping` currently supports ITEM, CUSTOMER, SUPPLIER and ACCOUNT reference links. Its uniqueness is `(company,kind,sourceId)`; its account target is a foreign key. The existing kinds have no documented posting-role semantics and must not be silently reinterpreted.
- Current AR/AP balance reports are current-state subsidiary balances from posted Finance documents, memos and allocations. They exclude legacy party opening balances. They do not accept an as-of date.
- Existing inventory management reports use current warehouse quantities multiplied by a current landed/manual reference price. That is a different measure from the Inventory ledger account, with the known receipt/bill/timing limitations already documented in the main audit.

## A-RPT — recommended approved reporting scope

### RPT-1: ledger-based financial reports and dashboard

**Recommendation:** introduce read-only accrual reports from the complete posted ledger, in the existing PHP currency, using company-local Asia/Manila calendar dates. Do not create opening/closing journals, change old amounts or pull payroll totals into Books.

This first package can be implemented without changing transaction/posting tables. It produces useful reports using the current five account types; it must show the limits below instead of inventing statutory classifications.

#### Exact period and completeness rules

1. Accept explicit `from=YYYY-MM-DD` and `to=YYYY-MM-DD`; both are inclusive calendar dates in Asia/Manila. Convert to `[from00:00+08:00, dayAfterTo00:00+08:00)` before querying `AccountingJournal.date`.
2. A Balance Sheet uses `asOf=YYYY-MM-DD` and includes journal dates before the next Manila midnight. Journal `createdAt`, invoice due date and UTC calendar day are not substitutes for the posting date.
3. Include only `POSTED` journals and company-matching accounts. Include archived accounts with historical entries. Never restrict financial totals to the dashboard's recent100 journals,1,000 account list or the first report page.
4. Calculate amounts with Prisma Decimal/exact cents in the backend; return monetary strings and server-generated totals. The frontend formats values and charts the returned series; it does not recompute the statements from limited rows.
5. Use one repeatable-read snapshot per report response. Paginate detail records separately while totals aggregate the entire selected scope. An account-specific General Ledger is a subset and is not expected to balance across both sides by itself.
6. Return scope, currency, time zone, dates, generatedAt, completeness and any limitations with every report/export. An error produces an error state; it must not turn into financial zeros.

#### General Ledger and Trial Balance

- General Ledger per account: opening signed balance from entries before `from`, then dated posted debits/credits and running balance during the period; closing equals opening+period debits−period credits. Stable order is journal date, journal ID and entry ID; cursor paging must retain a correct server-calculated opening/running balance.
- Period Trial Balance: opening debit/credit columns, period debit/credit movements and closing debit/credit columns per account. Signed amount is debit−credit; a positive signed amount occupies the debit column, a negative amount the credit column. Total opening and closing debits/credits should agree for a complete company ledger.
- Cumulative all-history trial balance remains available, explicitly labelled as such. Existing overview behavior need not change.

#### Profit and Loss

- Revenue = sum(revenue-account credits−debits) inside the selected period.
- Expenses = sum(expense-account debits−credits) inside the selected period.
- Posted-ledger profit/loss = revenue−expenses. VAT, AR/AP receipts/payments, asset purchases and equity movements are not automatically treated as income/expenses merely because they change cash.
- With only the current account types, show individual revenue/expense accounts and total expenses; do not guess current/non-current categories, operating/non-operating labels, EBITDA, tax expense or other statutory subtotals from names/code ranges.
- The existing sales-margin report remains separately labelled margin; it is not the new P&L source.
- There is currently no closing-entry classification. The minimal package includes every posted revenue/expense entry in the chosen period and clearly reports that manual period-closing entries can affect the result. It must not guess “closing” from memo text. If historical manual closing journals exist, accountant-approved tagging is required before the report can claim to exclude them. Adding such tagging is a separate reporting metadata approval, not a hidden alteration of immutable journal history.

#### Balance Sheet, opening balances and earnings

- Assets = debit−credit balances of ASSET accounts through the as-of cutoff.
- Liabilities and recorded equity = credit−debit balances of their respective account types through the same cutoff.
- Display **unclosed ledger earnings** separately in equity: accumulated revenue credit balances minus accumulated expense debit balances through the cutoff. This is a report presentation only, not a new retained-earnings account or a closing entry.
- Equity shown = recorded equity+unclosed ledger earnings. Reconciliation difference = assets−liabilities−recorded equity−unclosed earnings, expected0 for a complete balanced ledger.
- Do not add legacy customer/supplier opening balances or a bank statement's opening balance automatically. Approved opening journals already in Books form part of the ledger; missing openings remain a documented reconciliation issue.
- Do not simultaneously add a separately calculated “current-year profit” on top of all unclosed ledger earnings. That would double count earnings. If an accountant later approves a fiscal closing model, split prior unclosed/current-year earnings under that approved model.
- This is a basic type-grouped Balance Sheet. Current/non-current separation, statutory presentation and a formal retained-earnings rollforward require classifications not currently stored.

#### Dashboard measures that this package may expose

| Requested concept | Exact supported measure and label |
| --- | --- |
| Total Sales | **Posted revenue (excludes VAT)** from the chosen P&L period; if specifically showing sales rather than all revenue, restrict to explicitly approved sales-revenue accounts. |
| Total Expenses | **Posted expenses** from the same P&L period, including COGS; display COGS separately only when its account classification is explicit. |
| Net Profit | **Posted-ledger profit/loss**, with source-scope/opening/closing limitations visible. |
| Cash/Bank | **Configured cash and bank ledger balance** as-of cutoff. Reserved1000 is the existing default Bank and cash account; additional accounts need explicit identification before inclusion. No name matching or all-ASSET summation. |
| AR/AP | Two separately labelled sources: receivable/payable ledger balances as-of date; current Finance subsidiary balances and their known legacy-opening scope. Do not call the subsidiary balance historical until RPT-3 is approved. |
| Outstanding/Overdue invoices | Current posted Finance invoice balances only; outstanding>0, overdue dueDate<current Manila date. A selected historical dashboard date must show these cards as current, not pretend they are as-of values. |
| Inventory Value | **Inventory ledger balance** for explicitly identified inventory accounts; current **warehouse reference valuation** remains a separate operational measure. Expose their difference only as a reconciliation issue, not an automatic adjustment. |
| Trends | Calendar-month posted revenue/expenses/profit from the same ledger snapshot and period; months without entries are zero movements, not fabricated sample data. |
| Recent transactions | Company-scoped posted journals, clearly paginated/limited independently of full totals. |

Permission recommendation: existing Books read permission for the financial statement endpoints. For financial dashboard cards, require both the existing Executive access and the relevant existing Books/Finance read access; do not expose accounting totals merely because a Warehouse/AI role can open the Executive workspace. Auditors remain read-only. This tightens disclosure under the already existing role model and requires explicit approval as part of this package.

Suggested additive API shape: `/phase3/books/reports/trial-balance`, `/general-ledger`, `/profit-loss`, `/balance-sheet`, `/financial-overview`, each under the existing Books guard and company header. Existing11 management reports and their role filtering remain available.

### RPT-2: complete cash-flow classification, separately approved

**Recommendation:** direct method, with explicit operating/investing/financing classification of cash ledger movements. Do not derive a complete cash-flow statement from account type alone.

Why new metadata is needed: Dr equipment100+Dr prepaid expense50−Cr bank80−Cr AP70 is balanced, but the lines alone do not establish which80 was actually paid for equipment versus prepaid expense. A proportional allocation would be a new accounting assumption. No automatic proportional rule is proposed.

Smallest auditable design:

1. Identify the company's cash/equivalent ledger accounts explicitly (start with standard1000 where present, visibly editable only under approved Finance/Management settings). Never change historical account types to create classifications.
2. Add an **append-only cash-flow classification record** for a posted cash ledger entry, with one or more signed operating/investing/financing allocations; their exact sum must equal that entry's debit−credit. Internal transfers use a separately identified transfer classification and must reconcile to zero across the included cash/equivalent accounts.
3. Scope/authorize every referenced cash entry, account and journal to the selected company. Classification changes append a new audited version; they do not update immutable journals/entries or delete older classifications.
4. Existing historical cash movements begin **Unclassified**, not automatically Operating. The report includes that bucket in its cash reconciliation and marks the statement **incomplete** until the unclassified amount/count and transfer exceptions are resolved.
5. Cash change = operating+investing+financing+unclassified, with internal transfers excluded only after their net-zero condition is established. Closing cash = opening cash+cash change. Foreign-currency translation is not introduced; current ledger postings are PHP.
6. No automatic financing/opening entries or payment classification changes are bundled. If new supplier/customer payments should receive default classifications, approve those source rules separately. An inventory supplier payment is normally an operating candidate in the examples, but that is not a rule silently applied to all bills.

Schema addition/migration is required for persistent audited classifications. No historical financial amounts are rewritten. The rollback disables the new classification/report UI/API and leaves additive metadata/history intact; it does not delete posted entries.

### RPT-3: historical AR/AP aging, separately approved

Current `FinanceService.balances` is current-state. Historical reporting would need issue/posting effective dates, effective memo dates and payment paidAt filtering through the selected as-of date, plus a policy for documents backdated after a period has been reviewed. `postedAt` and `issueDate` answer different questions.

Recommendation: as-of **effective issue/memo/payment date**, restricted to currently posted documents and accompanied by a generated-at timestamp; do not claim it is a frozen “what users knew then” report. A closed-period/audit-cutoff snapshot feature is a different workflow. No legacy party balances are included without accountant-approved opening entries. This requires its own expected-result tests and explicit approval.

### Worked independent acceptance fixture for RPT-1/RPT-2

All values are illustrative test expectations only and must never seed a live dashboard. Date basis: October1–31,2026, Manila.

| Date/source | Debit | Credit |
| --- | --- | --- |
| September30 approved opening journal | Bank1,000 | Equity1,000 |
| October purchase bill | Inventory700; InputVAT84 | AP784 |
| October invoice | AR1,120; COGS400 | Sales1,000; OutputVAT120; Inventory400 |
| October customer receipt | Bank600 | AR600 |
| October supplier payment | AP300 | Bank300 |
| October paid operating expense | Expense100 | Bank100 |

Expected October P&L: revenue1,000, COGS400, other expense100, total expenses500, profit500. A sales-margin-only dashboard would show600 and would miss the expense100; the new posted-ledger result is500.

Expected October31 balances: Bank1,200, Inventory300, AR520, InputVAT84; assets2,104. AP484+OutputVAT120=liabilities604. Recorded equity1,000+unclosed earnings500=equity1,500. Equation:2,104=604+1,500. September opening equity is not added again as October income.

With explicitly approved operating classifications for receipt600/supplier payment300/expense100: operating net200, investing0, financing0, opening cash1,000, closing1,200. The September opening journal is outside the period. If that capital contribution instead occurred inside October, it would be a financing inflow, not an opening balance.

Expected subsidiary values for this fixture: AR520 and AP484, matching their ledger controls. Any different imported legacy opening balances must appear as unresolved differences, not be automatically added.

### Reporting tests and rollback

- Independently recalculate the worked fixture with integer cents, then compare actual API rows, server totals and exports. Add an expense to prove posted margin and net profit differ correctly.
- Verify Manila boundary entries at15:59:59.999Z and16:00:00Z, year boundaries, empty periods, negative/reversing entries, archived accounts, more than1,000 accounts/100journals, large exact values, and stable paginated General Ledger running balances.
- Check the accounting equation without inventing retained-earnings postings; include approved opening entries and a manual closing-entry scenario to expose the documented classification limitation.
- Verify role/company isolation, read-only SQL/API behavior, failure states and zero writes while generating/exporting reports. Protect payroll files and compare their regression hashes/results.
- For RPT-2, test mixed and split cash allocations, internal transfers, unclassified amounts, classification history, contradictory classifications and zero-difference cash reconciliation.
- Roll back report/API/UI code; retain all existing postings. New additive metadata migrations need a separately reviewed down/disable plan and must never remove financial history.

**Approval question RPT-1:** Do you approve this specific logic change: add the posted-ledger, PHP/Manila, read-only reports/dashboard described in RPT-1, with no opening/closing postings, explicit limitations and existing permission requirements? **YES or NO?**

**Approval question RPT-2:** Do you approve this specific logic/database change: add explicit append-only cash-flow classifications and the incomplete/unclassified-aware direct-method report described in RPT-2? **YES or NO?**

**Approval question RPT-3:** Do you approve this specific logic change: add historical AR/AP reports on the effective-date basis described in RPT-3, without treating them as immutable period-close snapshots or adding legacy balances? **YES or NO?**

## A-MAP — recommended smallest posting mapping package

### Do not reinterpret existing reference links

Recommendation: introduce an explicit **POSTING_ROLE** kind in `AccountingMapping`, retaining current ITEM/CUSTOMER/SUPPLIER/ACCOUNT links as reference information. A company can configure a target account for a named automatic posting role. Missing role mapping uses the existing standard account; an invalid/inactive/foreign/wrong-type explicit mapping fails before posting and is never silently ignored.

This needs an additive migration to permit the new kind in the current database kind check. Existing mapping rows are unchanged and do not suddenly reroute money. No new numeric type, currency conversion, VAT rule, price, quantity, stock timing or approval-limit formula is introduced.

| Posting role | Existing fallback | Required target type | Current use |
| --- | --- | --- | --- |
| BANK_CASH |1000|ASSET, explicitly identified as cash/bank|Customer/supplier payments|
| INVENTORY |1200|ASSET|Bill capitalization and invoice COGS credit|
| AR_CONTROL |1300|ASSET|Invoices/customer payment clearing|
| INPUT_VAT |1400|ASSET|Bills and relevant memos|
| AP_CONTROL |2100|LIABILITY|Bills/supplier payment clearing|
| OUTPUT_VAT |2200|LIABILITY|Invoices and relevant memos|
| SALES_REVENUE |4000|REVENUE|Invoices and financial sales memos|
| IMPORT_EXPENSE |5000|EXPENSE|Approved bill lines and matching AP memos|
| COGS |5100|EXPENSE|Invoice cost posting, unchanged cost reference method|
| SERVICE_EXPENSE |6000|EXPENSE|Approved service-expense bill lines and matching AP memos|
| LANDED_ACCRUAL |2400|LIABILITY|Reserved/inactive until a separately approved landed/accrual posting workflow exists; mapping it does not create that workflow|

Manual equity/capital journals retain the account explicitly selected by the user. There is no automatic EQUITY mapping role or new automatic opening journal in this package.

### Resolution, validation and history rules

1. Automatic Finance posting builds its existing amounts, resolves named roles inside the same transaction, validates active company-owned accounts and expected types, and posts exact balanced entries. The existing approval amount stays the document/payment amount; remapping must not raise/lower approval requirements.
2. Manual Books journals continue to post the exact account codes entered; they are not silently remapped. Existing direct account selections on bill lines1200/5000/6000 continue to select their semantic Inventory/Import expense/Service expense role; custom bill account selection is not added silently.
3. Missing roles use their existing standard fallback and existing initialize-account validation. If the user deliberately configured a mapping but its target was archived/removed/type-invalid, posting is blocked with a specific configuration error. A mapping cycle cannot be followed: resolve exactly one semantic role→account, not recursive ACCOUNT reference chains.
4. Existing reference mappings remain display/reference only. Type compatibility alone is insufficient to turn an ITEM mapping into three different revenue/inventory/COGS roles. Customer/supplier mappings also need an explicit AR/AP-control meaning before they can become posting instructions.
5. **Freeze the actual resolved accounts at successful posting.** An invoice/bill's immutable posted source journal supplies the provenance for later payment clearing and memos; preserve a source-account snapshot/reference where needed. Later mapping changes apply only to new postings, never to stored journal entries or old document amounts.
6. Customer payments against old invoices clear the original invoice AR-control account, even if AR_CONTROL is now mapped elsewhere. Multi-invoice payments group allocated amounts by each original control account; their bank side uses the currently selected approved BANK_CASH role. Supplier payments work analogously for original AP controls.
7. Credit/debit memos adjust the original posted revenue/expense/capitalization and VAT/control accounts. AP proportions still follow the existing approved amount allocation rule; a new mapping cannot move a reversal into a different account than its source. This package does not introduce stock/COGS returns.
8. A posted historical source with no verifiable original journal/account provenance must be flagged and blocked from mapping-dependent automatic clearing/reversal pending Finance review. Do not guess its original account from the current mapping. This is a workflow restriction that must be explicitly approved as part of A-MAP; a legacy migration/repair is not automatic.
9. Setting/changing a posting role requires the existing Books write/approval authorization and appends an audit record identifying previous/next account. Journal output records actual account IDs/codes; the UI must preview which account will be used without treating a preview as a reservation.

### Before/after mapping example

Existing invoice100+VAT12 and cost50:

```text
Dr AR1300 112; Cr Revenue4000 100; Cr OutputVAT2200 12;
Dr COGS5100 50; Cr Inventory1200 50.
```

After explicitly mapping AR→1310, Revenue→4100, COGS→5110 and Inventory→1210, a **new** equivalent invoice posts:

```text
Dr AR1310 112; Cr Revenue4100 100; Cr OutputVAT2200 12;
Dr COGS5110 50; Cr Inventory1210 50.
```

Both have total debits162=credits162. Prices, VAT, total112 and margin50 are unchanged; account allocation changes, which is why explicit approval is required. The old journal remains unchanged.

If a later receipt60 allocates40 to the old invoice and20 to the new one, with BANK_CASH mapped to1010:

```text
Dr Bank1010 60; Cr old AR1300 40; Cr new AR1310 20.
```

Crediting the whole60 to current1310 would leave the old invoice's control account unreconciled. This is why a simple global string replacement in `postJournal` is insufficient.

### Optional future per-party/item overrides, not included in the smallest package

If needed, define separate unambiguous kinds such as CUSTOMER_AR, SUPPLIER_AP, ITEM_REVENUE, ITEM_INVENTORY and ITEM_COGS, with source existence/company checks and role-specific types. Precedence could be explicit per-party/item role override→company POSTING_ROLE→existing standard. This is a separate approval and schema/validation expansion. Do not repurpose the existing generic ITEM/CUSTOMER/SUPPLIER links, whose historical intent is reference-only.

### Mapping tests and rollback

- Check every active role's fallback and explicit mapping; wrong type, inactive/foreign/deleted target, missing standard account and malformed role IDs must fail before journal creation.
- Prove new invoice/bill/payment/memo account choices against independent expected entries and exact balanced totals; verify amounts/approval thresholds unchanged.
- Change a mapping between two invoices, then test the mixed-source receipt and credit memos against original accounts. Test multiple AP accounts/proportions, absent historical provenance and concurrent mapping edits/posting.
- Verify manual journals are unaffected, reference links remain reference-only, no accidental ITEM interpretation occurs, and historical posted entries cannot be updated/deleted.
- Run source/ledger reconciliation across all old/new control accounts; reports must not sum only the new current mapping and omit older balances.
- No production records are reclassified automatically. Roll back mapping-aware code/UI and disable creation of new POSTING_ROLE configurations; retain additive metadata/audit rows and the immutable journals already posted. Reverting account allocation after posting requires an approved correction/reversal, not deleting history.

**Approval question A-MAP:** Do you approve this specific posting/database change: the named POSTING_ROLE package above, existing-standard fallbacks, preserved reference/manual mappings, frozen source-account clearing/reversals, explicit invalid/provenance failures and no historical reclassification? **YES or NO?**

## Decisions the owner/accountant must confirm

1. Approve or reject **RPT-1**, **RPT-2**, **RPT-3** and **A-MAP** separately. A general request to finish the master task does not answer these financial-policy approvals.
2. For RPT-1, confirm posted-ledger accrual reports, PHP and Manila dates. The recommendation avoids assuming a fiscal-year start; explicit date filters work immediately. Add fiscal-year/YTD defaults only after confirming the company's actual fiscal calendar.
3. Identify any historical manual closing journals and required statutory current/non-current/retained-earnings presentation. Missing metadata must remain visible; it cannot be inferred from memo/name text.
4. For RPT-2, identify the full cash/equivalent account set and approve the classification workflow. Retaining Unclassified amounts is the recommended default until Finance reviews them.
5. For A-MAP, confirm company-level named-role mapping is sufficient initially, or request a separate per-party/item override proposal. Approve the block on unverified historical source accounts or supply a reviewed legacy-account provenance plan.

No approval is inferred in this document, and no production financial change has been implemented from it. The worked fixtures are acceptance specifications, not claims that unimplemented reports were tested or that production balances reconcile.

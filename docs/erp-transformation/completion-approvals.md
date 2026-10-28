# Remaining ERP changes: specific approval packages

**Disposition — October 26, 2026:** A-DB, A-MEM and A-REC were explicitly approved in this chat and implemented/tested on the development branch. Production migration/release was not performed. See [completion verification](completion-verification.md) for current evidence and rollback details. The original proposal text below is retained as the approval record.

Prepared October 26, 2026, on `codex/erp-ui-accounting-audit`. These are implementation proposals, not deployed changes. Payroll calculations/UI, existing saved financial amounts and stock issue timing are excluded. A general request to complete the project is not treated as approval of unspecified accounting policies, consistent with the master prompt.

## A-DB — Allocation ownership enforced by PostgreSQL

**Existing behavior/evidence:** the API rejects payment allocations whose payment and invoice/bill have different company, direction or customer/supplier. Simple database ID foreign keys do not enforce that equality. The committed real-PostgreSQL audit demonstrates a cross-company insert succeeding inside a transaction that is deliberately rolled back.

**Specific modification:** add company, direction and partyId metadata to FinanceAllocation; backfill only from already matching parents. Add unique `(id, company, direction, partyId)` keys to FinancePayment and FinanceDocument and composite foreign keys from each allocation to both parents, with restrictive update/delete actions. The migration first rejects any existing mismatched parent pair and does not repair/delete it. The application supplies validated parent metadata on new allocations. No amount, date, status, journal or payroll value is recalculated. The normal allocation pair uniqueness and positive-amount check remain.

**Before/after:** a direct allocation linking a Company B payment to a Company A invoice can currently pass ID foreign keys; after the change it fails atomically. A valid Company A payment40 allocated to its Company A invoice112 still leaves AR72. Updates cannot move either linked parent to another company/party/direction while allocations exist.

**Impact:** a Prisma/SQL migration, Finance payment nested creates and direct SQL/import tools that insert allocations. Existing valid allocations receive ownership metadata only. Normal API amounts and authorization are unchanged. Implementation and migration tests run only on the isolated DB; production migration is a separate release action after read-only preflight/backup review.

**Tests:** same-company success; foreign company, party and direction rejected; parent updates rejected; absent parents, positive amounts and duplicate-pair checks retained; concurrent parent change/allocation insertion; valid payment/journal rollback and AR/AP totals; original failing DB assertion passes without weakening it.

**Rollback:** a reviewed inverse migration removes only the new foreign keys, ownership metadata and redundant parent unique keys, restoring the original ID foreign keys. It never removes payment/document/allocation rows or alters monetary history. Reverting weakens database enforcement; prefer a forward fix. Production data is never reset.

**Do you approve this specific logic change? YES or NO?**

## A-MEM — Exact-replay protection for credit/debit memos

**Existing behavior/evidence:** every accepted memo call creates a new memo and journal. It has no client submission key. The existing document cap does not distinguish a network retry from a second intentional memo.

**Specific modification:** require a client-generated submission key; store `MEMO:<key>` in the existing unique `(company, sourceKey)` field. Compare the normalized source document, kind, exact amount and trimmed reason before treating a request as a replay. An exact replay returns the existing memo and creates no journal/audit/number. Reusing a key with different content returns409. A new intentional memo uses a new key. The UI retains a submission key while retrying unchanged content and changes it for a new intentional submission. Legacy saved memos keep their existing data; no duplicate historical records are auto-deleted.

**Before/after:** invoice112 and a single intended credit11.20 can become89.60 after an accidental duplicate today. With the same submission key, both requests resolve to one memo and balance100.80. A deliberately separate key remains eligible for a second11.20 credit under the existing cap. VAT allocation, amount approval, stock and COGS rules remain unchanged.

**Impact:** memo UI/API and API consumers must send the key. Existing unique source-key support avoids a memo-specific schema change. Concurrent conflicts must return the existing exact replay when safely identifiable, otherwise a controlled409 rather than duplicate posting.

**Tests:** sequential/concurrent exact retries, changed-key content conflicts, intentional different keys, approval/company isolation, original cap/VAT/AP proportional reversal tests, one memo/one journal/one audit/one number under retries, and unchanged saved records.

**Rollback:** revert client/server key enforcement; leave new stored source keys and all posted history in place. No data migration or monetary recalculation is required.

**Do you approve this specific logic change? YES or NO?**

## A-VAL/A-INT — Inventory valuation and reconciliation policy under preparation

The current valuation is warehouse-only current cost-reference quantity × cost; it excludes office stock and is not a historical costing subledger. New automatic stock capitalization cannot safely be added to existing bill capitalization without an approved event/cutover policy, because that can double debit Inventory. A separate read-only reconciliation proposal will show office/warehouse references and recorded Inventory balances without altering physical stock or creating journals. Automatic receipt/adjustment/cost-change posting is a distinct decision.

### A-REC — recommended read-only inventory reconciliation workbench

**Specific modification:** retain the existing warehouse valuation report and add a current-snapshot reconciliation under Books, requiring both existing Books and Finance read access. Show office quantity (`Product.currentStock`) and warehouse quantity (`WarehouseStock.quantity`) separately, then apply the existing approved-landed/manual-reference cost to each pool. Reserved/blocked stock remains physical stock and is not added twice from lot records. Include office-only products and every company-owned record, without using the old1,000-row report limit. Missing/invalid cost or orphan stock references are explicit exceptions; an incomplete cost basis never becomes a made-up zero comparison.

Compare the combined current reference value with the current posted Inventory ledger balance across standard, configured and frozen historical inventory-role accounts. Use one repeatable-read snapshot, exact decimal cents and Manila date basis. Show the difference and source/scope limitations. A difference is a reconciliation item; it does not prove the reference value is statutory historical cost or authorize a correcting entry. Existing manual journals remain the controlled correction workflow after Finance reviews source evidence.

**Before/after example:** warehouse10×100 currently shows1,000 and omits office5×100. The new workbench shows warehouse1,000, office500 and combined reference1,500. If the posted Inventory ledger is1,200, it displays a300 reference-versus-ledger difference. It does not post300 or change stock, bills, COGS, dispatch timing, manual prices, historical costs or payroll.

**Tests:** independently calculated office/warehouse/reference/ledger totals; office-only products; reserved stock not double counted; missing/zero/invalid cost evidence; large monetary values; company and role isolation; full dataset and exact export; journal/quantity/cost history unchanged after reading/exporting. **Rollback:** remove only the additive report API/UI; no migration or data repair is needed.

**Do you approve this specific logic change? YES or NO?**

## A-RPT/A-MAP — Statement definitions and posting-account selection

Exact proposals are being prepared separately against the current ledger. New statements must state their journal-date basis, classifications, opening/current earnings and cash classifications. Account mapping must preserve original posted control accounts when later payments/memos settle them. No statement may present invoice margin as net profit or classify every asset as cash.

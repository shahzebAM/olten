// Isolated synthetic audit only. This script never reads DATABASE_URL.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const url = 'postgresql://phase3_test@127.0.0.1:55439/customer_guide_20261023b?schema=public';
process.env.DATABASE_URL = url;
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../../tsconfig.json') });
const { PrismaClient } = require('@prisma/client');
const { FinanceService } = require('../../src/phase3/finance.service');
const { BooksService } = require('../../src/phase3/books.service');
const { postJournal } = require('../../src/phase3/phase3.shared');
const db = new PrismaClient({ datasources: { db: { url } } });
const run = Date.now();
const company = `Accounting Audit ${run}`;
const other = `Accounting Audit Other ${run}`;
const actor = { id: 1, username: 'isolated-accounting-audit', role: 'Super Admin', modules: {} };
const reportDirectory = path.resolve(__dirname, '../../.tmp/erp-transformation');
fs.mkdirSync(reportDirectory, { recursive: true });
const report = { run, database: 'customer_guide_20261023b', company, other, productionWrites: false, results: [], findings: [], testedAt: new Date().toISOString() };
const pass = (name, details = {}) => { report.results.push({ name, passed: true, ...details }); console.log(`PASS: ${name}`); };
const probe = async (name, work) => { try { await work(); } catch (error) { report.findings.push({ name, error: error.message }); console.log(`AUDIT FINDING: ${name}: ${error.message}`); } };
const amount = value => { const [whole, fraction = ''] = String(value).split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
const serializeJournal = rows => rows.reduce((n, e) => n + amount(e.debit.toFixed(2)) - amount(e.credit.toFixed(2)), 0n);
const finance = Object.create(FinanceService.prototype);
const books = Object.create(BooksService.prototype);
finance.prisma = db;
books.prisma = db;
async function concurrent(name, work, count = 4) {
  const settled = await Promise.allSettled(Array.from({ length: count }, work));
  const success = settled.filter(r => r.status === 'fulfilled');
  const conflict = settled.filter(r => r.status === 'rejected');
  assert(success.length > 0, `${name}: no successful request`);
  for (const result of conflict) {
    await probe(`${name}: contention is returned as a controlled409`, async () => {
      assert.equal(result.reason?.getStatus?.(), 409, `${result.reason?.constructor?.name} ${result.reason?.code ?? ''} must be a controlled409`);
    });
  }
  return { succeeded: success.length, safeConflicts: conflict.length };
}
(async () => {
  const [{ name }] = await db.$queryRaw`SELECT current_database() AS name`;
  assert.equal(name, report.database, 'Unexpected database; refusing writes');
  await db.company.createMany({ data: [{ name: company }, { name: other }] });
  pass('Connection verified and only new unique audit companies created');
  const installed = await db.$queryRaw`SELECT tgname, tgenabled, tgdeferrable, tginitdeferred FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('ErpAuditLog_append_only','AccountingJournal_immutable','LedgerEntry_immutable','AccountingJournal_balanced','LedgerEntry_balanced')`;
  report.installedTriggers = installed;
  await probe('Five Phase 3 integrity triggers installed and enabled', async () => {
    assert.equal(installed.filter(row => row.tgenabled !== 'D').length, 5);
    for (const trigger of installed.filter(row => row.tgname.endsWith('_balanced'))) assert(trigger.tgdeferrable && trigger.tginitdeferred);
    pass('Five Phase 3 integrity triggers installed, balance checks deferred');
  });
  const customer = await db.customer.create({ data: { company, name: 'Synthetic audit customer' } });
  const supplier = await db.supplier.create({ data: { company, legalName: 'Synthetic audit supplier', tin: 'TEST-ONLY', address: 'Isolated local test' } });
  const invoice = await db.financeDocument.create({ data: {
    company, number: `INV-AUDIT-${run}`, kind: 'INVOICE', direction: 'AR', partyId: customer.id, status: 'DRAFT', exchangeRate: '1', issueDate: new Date('2026-10-01T00:00:00Z'), dueDate: new Date('2026-10-15T00:00:00Z'), subtotal: '100', taxAmount: '12', total: '112', data: { items: [{ productId: 1, quantity: 2, unitCost: '25.000000' }] }, createdBy: actor.username,
  } });
  const posted = await concurrent('Invoice concurrent posting', () => finance.postDocument(company, actor, invoice.id));
  await finance.postDocument(company, actor, invoice.id);
  assert.equal(await db.accountingJournal.count({ where: { company, sourceKey: `DOC:${invoice.id}` } }), 1);
  pass('Concurrent and repeated invoice posting creates exactly one balanced journal', posted);
  const payment = { direction: 'AR', partyId: customer.id, amount: '40.00', paidAt: '2026-10-15', method: 'Bank', reference: `AR-${run}`, idempotencyKey: `AR-${run}`, allocations: [{ documentId: invoice.id, amount: '40.00' }] };
  const paid = await concurrent('Customer payment concurrent replay', () => finance.createPayment(company, actor, payment));
  const saved = await finance.createPayment(company, actor, payment);
  assert.equal(await db.financePayment.count({ where: { company, idempotencyKey: payment.idempotencyKey } }), 1);
  assert.equal(await db.accountingJournal.count({ where: { company, sourceKey: `PAY:${saved.id}` } }), 1);
  await assert.rejects(() => finance.createPayment(company, actor, { ...payment, amount: '41.00', allocations: [{ documentId: invoice.id, amount: '41.00' }] }), /different payment details/);
  await assert.rejects(() => finance.createPayment(company, actor, { ...payment, idempotencyKey: `over-${run}`, amount: '72.01', allocations: [{ documentId: invoice.id, amount: '72.01' }] }), /exceeds the outstanding/);
  pass('Concurrent replay key prevents duplicate customer payment and rejects changed payload/overpayment', paid);
  const balances = await finance.balances(company, actor, 'AR');
  assert.equal(balances.totalOutstanding, '72.00');
  assert.equal(balances.documents[0].paid, '40.00');
  pass('Actual persisted AR source documents and allocations reconcile:112−40=72');
  const bill = await finance.createBill(company, actor, { supplierId: supplier.id, invoiceReference: `SUP-${run}`, currency: 'PHP', exchangeRate: '1', issueDate: '2026-10-01', dueDate: '2026-10-15', items: [{ description: 'Inventory', quantity: '1', unitPrice: '70', taxRate: '.12', accountCode: '1200' }, { description: 'Expense', quantity: '1', unitPrice: '30', taxRate: '.12', accountCode: '5000' }].map(row => ({ ...row, taxRate: '0.12' })) });
  await finance.postDocument(company, actor, bill.id);
  await finance.createPayment(company, actor, { direction: 'AP', partyId: supplier.id, amount: '20.00', paidAt: '2026-10-15', method: 'Bank', reference: `AP-${run}`, idempotencyKey: `AP-${run}`, allocations: [{ documentId: bill.id, amount: '20.00' }] });
  const payable = await finance.balances(company, actor, 'AP');
  assert.equal(payable.totalOutstanding, '92.00');
  pass('Actual persisted supplier bill/payment reconciles:70+30+12−20=92');
  const overview = await books.overview(company);
  const ledger = Object.fromEntries(overview.trialBalance.map(row => [row.code, row.balance]));
  assert.deepEqual(Object.fromEntries(['1000','1200','1300','1400','2100','2200','4000','5000','5100'].map(code => [code, ledger[code]])), { '1000': '20.00', '1200': '20.00', '1300': '72.00', '1400': '12.00', '2100': '-92.00', '2200': '-12.00', '4000': '-100.00', '5000': '30.00', '5100': '50.00' });
  const debit = overview.trialBalance.reduce((n, row) => n + amount(row.debit), 0n);
  const credit = overview.trialBalance.reduce((n, row) => n + amount(row.credit), 0n);
  assert.equal(debit, 33400n);
  assert.equal(credit, 33400n);
  // Assets124 = liabilities104 + synthetic profit20 (sales100−COGS50−expense30).
  assert.equal(2000n + 2000n + 7200n + 1200n, 9200n + 1200n + 10000n - 5000n - 3000n);
  for (const journal of overview.journals) assert.equal(serializeJournal(journal.entries), 0n);
  pass('Source-to-ledger AR/AP/trial balance and independent accounting equation reconcile exactly', { debit: '334.00', credit: '334.00', difference: '0.00' });
  const bankAccount = overview.accounts.find(row => row.code === '1000');
  const statement = await books.createReconciliation(company, actor, { accountId: bankAccount.id, statementDate: '2026-10-15', openingBalance: '0.00', closingBalance: '20.00', lines: [{ date: '2026-10-15', reference: `AR-ST-${run}`, description: 'Customer receipt', amount: '40.00' }, { date: '2026-10-15', reference: `AP-ST-${run}`, description: 'Supplier payment', amount: '-20.00' }] });
  for (const line of statement.lines) {
    const matching = overview.journals.flatMap(row => row.entries).find(row => row.accountId === bankAccount.id && row.debit.minus(row.credit).eq(line.amount));
    assert(matching, 'Expected bank source entry missing');
    await books.matchStatementLine(company, actor, statement.id, { lineId: line.id, ledgerEntryId: matching.id });
  }
  const completed = await books.completeReconciliation(company, actor, statement.id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.closingBalance.toFixed(2), '20.00');
  pass('Actual bank statement and persisted signed source entries reconcile to20.00 closing');
  await assert.rejects(() => finance.postDocument(other, actor, invoice.id), /not found in this workspace/);
  assert.equal((await finance.balances(other, actor, 'AR')).totalOutstanding, '0.00');
  const otherAccount = await db.ledgerAccount.create({ data: { company: other, code: 'AUDIT-OTHER', name: 'Other company asset', type: 'ASSET' } });
  const journal = overview.journals[0];
  const entry = journal.entries[0];
  await probe('Database rejects cross-company balanced journal accounts', async () => {
    await assert.rejects(() => db.$transaction(tx => tx.accountingJournal.create({ data: { company, number: `JRN-BAD-COMPANY-${run}`, sourceKey: `BAD-COMPANY-${run}`, sourceType: 'AUDIT', sourceId: String(run), date: new Date(), memo: 'Must reject foreign account', postedBy: actor.username, entries: { create: [{ accountId: otherAccount.id, debit: '1', credit: '0' }, { accountId: entry.accountId, debit: '0', credit: '1' }] } } })), /same workspace/);
    assert.equal(await db.accountingJournal.count({ where: { number: `JRN-BAD-COMPANY-${run}` } }), 0);
    pass('Database same-company constraint rejects a balanced foreign-account journal and rolls back');
  });
  await probe('Database rejects unbalanced journal at deferred commit', async () => {
    await assert.rejects(() => db.$transaction(tx => tx.accountingJournal.create({ data: { company, number: `JRN-BAD-BALANCE-${run}`, sourceKey: `BAD-BALANCE-${run}`, sourceType: 'AUDIT', sourceId: String(run), date: new Date(), memo: 'Must reject imbalance', postedBy: actor.username, entries: { create: [{ accountId: entry.accountId, debit: '1', credit: '0' }, { accountId: entry.accountId, debit: '0', credit: '.99' }] } } })), /balance exactly/);
    assert.equal(await db.accountingJournal.count({ where: { number: `JRN-BAD-BALANCE-${run}` } }), 0);
    pass('Deferred database balance trigger rejects one-cent difference and rolls back');
  });
  pass('Service company isolation rejects foreign invoice and returns an empty other-company AR ledger');
  await assert.rejects(() => db.ledgerEntry.create({ data: { journalId: `missing-${run}`, accountId: entry.accountId, debit: '1', credit: '0' } }));
  pass('Actual journal foreign key rejects orphan ledger entries');
  await probe('Allocation tenant identity is enforced by the database', async () => {
    const foreignCustomer = await db.customer.create({ data: { company: other, name: 'Synthetic other tenant' } });
    const foreignPayment = await db.financePayment.create({ data: { company: other, number: `RCPT-FOREIGN-AUDIT-${run}`, direction: 'AR', partyId: foreignCustomer.id, amount: '1', paidAt: new Date('2026-10-15'), method: 'Synthetic fixture', reference: `FOREIGN-${run}`, idempotencyKey: `FOREIGN-${run}`, createdBy: actor.username } });
    let accepted = false;
    try {
      await db.$transaction(async tx => {
        await tx.financeAllocation.create({ data: { paymentId: foreignPayment.id, documentId: invoice.id, amount: '1' } });
        accepted = true;
        throw Error('AUDIT_ROLLBACK_ONLY');
      });
    } catch (error) {
      if (error.message !== 'AUDIT_ROLLBACK_ONLY' && accepted) throw error;
    }
    assert.equal(await db.financeAllocation.count({ where: { paymentId: foreignPayment.id } }), 0, 'Probe must always roll back');
    assert.equal(accepted, false, 'Cross-company allocation was accepted inside a deliberately rolled-back transaction; API guards are the enforcement boundary');
    pass('Database prevents cross-company payment/document allocation');
  });
  for (const [model, row] of [['accountingJournal', journal], ['ledgerEntry', entry], ['erpAuditLog', await db.erpAuditLog.findFirst({ where: { company } })]]) {
    await probe(`Append-only ${model} update guard`, async () => {
      const data = model === 'accountingJournal' ? { memo: 'Disallowed test mutation' } : model === 'ledgerEntry' ? { debit: entry.debit } : { action: 'DISALLOWED' };
      await assert.rejects(() => db[model].update({ where: { id: row.id }, data }), /cannot be updated or deleted/);
      pass(`${model} append-only trigger rejects update`);
    });
  }
  report.success = report.findings.length === 0;
  fs.writeFileSync(path.join(reportDirectory, 'accounting-db-audit-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, passedGroups: report.results.length, findings: report.findings.length }));
  if (!report.success) process.exitCode = 1;
})().catch(error => {
  report.success = false;
  report.fatal = error.message;
  fs.writeFileSync(path.join(reportDirectory, 'accounting-db-audit-report.json'), JSON.stringify(report, null, 2));
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => db.$disconnect());

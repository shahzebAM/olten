// Run from backend against the compiled API on loopback port 3105 using the same isolated database.
// Synthetic fixtures only; never reads production DATABASE_URL or sends external requests.
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const url = 'postgresql://phase3_test@127.0.0.1:55439/customer_guide_20261023b?schema=public';
const db = new PrismaClient({ datasources: { db: { url } } });
const base = 'http://127.0.0.1:3105';
fs.mkdirSync('.tmp/erp-transformation', { recursive: true });
const results = [];
const run = Date.now();
async function check(name, path, expected, token, company, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(company ? { 'x-company': company } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, expected, `${name}: expected ${expected}, got ${response.status}`);
  results.push({ name, status: response.status });
  return response.json();
}
(async () => {
  const [{ name }] = await db.$queryRaw`SELECT current_database() AS name`;
  assert.equal(name, 'customer_guide_20261023b');
  const company = `Auth QA ${run}`, other = `Auth Foreign ${run}`;
  await db.company.createMany({ data: [{ name: company }, { name: other }] });
  const password = crypto.randomBytes(24).toString('hex');
  const hash = await bcrypt.hash(password, 10);
  async function actor(suffix, modules) {
    const username = `authqa_${run}_${suffix}`;
    await db.admin.create({ data: { username, password: hash, role: 'Admin', status: 'Active', modules: { ...modules, companies: { [company]: true } } } });
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 201);
    return (await response.json()).accessToken;
  }
  const full = await actor('full', { sales: true, purchasing: true, inventory: true, payroll: true });
  const purchasing = await actor('purchasing', { purchasing: true });
  const inventory = await actor('inventory', { inventory: true });
  const foreignCustomer = await db.customer.create({ data: { id: `AUTH-CUSTOMER-${run}`, company: other, name: 'Foreign synthetic customer' } });
  const foreignProduct = await db.product.create({ data: { company: other, sku: `AUTH-PRODUCT-${run}`, name: 'Foreign synthetic product', category: 'QA', unit: 'pcs', vatSetting: 'NONE', purchasePrice: 10, sellingPrice: 20, currentStock: 5 } });
  const ownProduct = await db.product.create({ data: { company, sku: `AUTH-OWN-${run}`, name: 'Owned synthetic product', category: 'QA', unit: 'pcs', vatSetting: 'NONE', purchasePrice: 10, sellingPrice: 20, currentStock: 5 } });
  const foreignEmployee = await db.employee.create({ data: { company: other, firstName: 'Foreign', lastName: 'Synthetic', dateOfBirth: new Date('1990-01-01'), address: 'Synthetic only', civilStatus: 'Single', baseRate: 100, employmentStatus: 'Regular' } });
  const q = encodeURIComponent(company);
  for (const path of ['/employees', '/employees/attendance/all', '/employees/payroll/all', '/settings', `/products?company=${q}`, `/sales/customers?company=${q}`, `/procurement/suppliers?company=${q}`, `/procurement/purchase-orders?company=${q}`, `/sales/quotations?company=${q}`, `/sales/packing-lists?company=${q}`]) {
    await check(`Unauthenticated ${path.split('?')[0]} rejected`, path, 401);
    await check(`Authorized ${path.split('?')[0]} returns own company`, path, 200, full, company);
  }
  await check('Query/header tenant mismatch rejected', `/products?company=${encodeURIComponent(other)}`, 403, full, company);
  await check('Unassigned company rejected', `/products?company=${encodeURIComponent(other)}`, 403, full, other);
  await check('Header-only unscoped legacy product list rejected', '/products', 400, full, company);
  await check('Foreign customer ID rejected before balance write', `/sales/customers/${foreignCustomer.id}/balance`, 404, full, company, 'PATCH', { amount: 10 });
  await check('Foreign product ID rejected before update', `/products/${foreignProduct.id}`, 404, full, company, 'PATCH', { sellingPrice: 999 });
  await check('Cross-company product reference rejected in PO', '/procurement/purchase-orders', 403, full, company, 'POST', { company, osReference: 'OS-QA-1', poNumber: 'PO-QA-1', items: [{ productId: foreignProduct.id, requestedQty: 1, unitCost: 10 }] });
  await check('Foreign employee cannot receive a payroll', '/employees/payroll', 404, full, company, 'POST', { employeeId: foreignEmployee.id });
  await check('Purchasing can read catalog dependency', `/products?company=${q}`, 200, purchasing, company);
  await check('Catalog read dependency does not grant writes', '/products', 403, purchasing, company, 'POST', { company, name: 'Rejected', sku: 'REJECTED' });
  await check('Inventory can read PO history dependency', `/procurement/purchase-orders?company=${q}`, 200, inventory, company);
  await check('Inventory can read tier categories dependency', `/sales/customer-categories?company=${q}`, 200, inventory, company);
  await check('Inventory can read tier prices dependency', `/sales/category-prices?company=${q}`, 200, inventory, company);
  await check('Inventory can read QR catalog dependency', `/sales/order-slips/all-products?company=${q}`, 200, inventory, company);
  await check('Inventory read dependency does not grant customer writes', '/sales/customers', 403, inventory, company, 'POST', { company, name: 'Rejected' });
  await check('Owned catalog update remains functional', `/products/${ownProduct.id}`, 200, inventory, company, 'PATCH', { sellingPrice: 25 });
  await check('Inventory retains tier-price write dependency', '/sales/category-prices/bulk', 201, inventory, company, 'POST', { company, categoryName: 'General', prices: [{ productId: ownProduct.id, price: 22 }] });
  const ownCustomer = await db.customer.create({ data: { id: `AUTH-OWN-CUSTOMER-${run}`, company, name: 'Owned synthetic customer' } });
  const os = await check('Authenticated OS half-cent creation', '/sales/order-slips', 201, full, company, 'POST', { customerId: ownCustomer.id, items: [{ productId: ownProduct.id, requestedQty: 1, unitPrice: 1.005 }], isVatApplied: true, vatRate: 0.12 });
  assert.equal(Number(os.subtotal), 1.01); assert.equal(Number(os.vatAmount), 0.12); assert.equal(Number(os.grandTotal), 1.13);
  const po = await check('Authenticated PO half-cent creation from OS', '/procurement/purchase-orders', 201, full, company, 'POST', { company, user: 'spoofed-user', osReference: os.osNumber, isVatApplied: true, vatRate: 0.12, items: [{ productId: ownProduct.id, requestedQty: 1, unitCost: 1.005, sku: ownProduct.sku, productName: ownProduct.name }] });
  assert.equal(Number(po.subtotal), 1.01); assert.equal(Number(po.vatAmount), 0.12); assert.equal(Number(po.grandTotal), 1.13);
  await check('Inventory retains own PO stock-placement status dependency', `/procurement/purchase-orders/${po.id}/status`, 200, inventory, company, 'PATCH', { status: po.status, user: 'spoofed-user' });
  assert.match((await db.purchaseOrder.findUnique({ where: { id: po.id } })).updatedBy, /^authqa_/);
  assert.equal((await db.product.findUnique({ where: { id: ownProduct.id } })).currentStock, 5);
  results.push({ name: 'OS and PO persist 1.01 subtotal and 1.13 grand total without deducting stock; trusted actor retained', status: 'passed' });
  assert.equal((await db.product.findUnique({ where: { id: foreignProduct.id } })).sellingPrice, 20);
  assert.equal((await db.customer.findUnique({ where: { id: foreignCustomer.id } })).balance, 0);
  assert.equal(await db.payroll.count({ where: { employeeId: foreignEmployee.id } }), 0);
  results.push({ name: 'Foreign records retain original amounts and no payroll was created', status: 'passed' });
  const books = await actor('books', { books: true, finance: true, erpRoles: ['Finance'], approvalLimits: { [company]: '10000.00' } });
  const booksOnly = await actor('books_only', { books: true, erpRoles: ['Finance'] });
  const auditor = await actor('auditor', { books: true, finance: true, erpRoles: ['Auditor'] });
  const dates = 'from=2026-10-01&to=2026-10-31';
  for (const kind of ['profit-loss','balance-sheet','trial-balance','financial-overview','cash-flow']) {
    await check(`Unauthenticated ${kind} rejected`, `/phase3/books/reports/${kind}?${dates}`, 401);
    await check(`Authorized ${kind} returns scoped ledger`, `/phase3/books/reports/${kind}?${dates}`, 200, books, company);
  }
  await check('Purchasing cannot read Books financial statements', `/phase3/books/reports/profit-loss?${dates}`, 403, purchasing, company);
  await check('Auditor can read statements', `/phase3/books/reports/profit-loss?${dates}`, 200, auditor, company);
  await check('Auditor cannot classify cash movements', '/phase3/books/cash-flow/classifications', 403, auditor, company, 'POST', {});
  await check('Cash classification cannot locate a foreign entry', '/phase3/books/cash-flow/classifications', 404, books, company, 'POST', { ledgerEntryId: 'foreign-entry', expectedVersion: 0, reason: 'Must reject' });
  await check('Books plus Finance can read inventory reconciliation', '/phase3/books/inventory-reconciliation', 200, books, company);
  await check('Books alone cannot read inventory cost reconciliation', '/phase3/books/inventory-reconciliation', 403, booksOnly, company);
  const invoice = await db.financeDocument.create({ data: { company, number: `INV-HTTP-${run}`, kind: 'INVOICE', direction: 'AR', partyId: ownCustomer.id, status: 'DRAFT', exchangeRate: '1', issueDate: new Date('2026-10-01'), dueDate: new Date('2026-10-31'), subtotal: '1', taxAmount: '.12', total: '1.12', data: { items: [{ productId: ownProduct.id, quantity: 1, unitCost: '0' }] }, createdBy: 'synthetic-http-fixture' } });
  await check('Finance can post an owned fixture invoice through the API', `/phase3/documents/${invoice.id}/post`, 201, books, company, 'POST', {});
  const memoBody = { documentId: invoice.id, kind: 'CREDIT_MEMO', amount: '0.11', reason: 'Synthetic API retry check', submissionKey: `api-memo-${run}` };
  const memo = await check('Memo submission succeeds with a key', '/phase3/memos', 201, books, company, 'POST', memoBody);
  const retry = await check('Memo retry returns the saved document', '/phase3/memos', 201, books, company, 'POST', memoBody);
  assert.equal(retry.id, memo.id);
  await check('Changed memo payload with same key conflicts', '/phase3/memos', 409, books, company, 'POST', { ...memoBody, amount: '0.12' });
  const report = { checkedAt: new Date().toISOString(), database: name, productionWrites: false, company, passed: results.length, results };
  fs.writeFileSync('.tmp/erp-transformation/legacy-auth-integration-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: results.length, productionWrites: false }));
})().catch(e => { console.error(e.message); fs.writeFileSync('.tmp/erp-transformation/legacy-auth-integration-failure.json', JSON.stringify({ passed: results.length, results, error: e.message }, null, 2)); process.exitCode = 1; }).finally(() => db.$disconnect());

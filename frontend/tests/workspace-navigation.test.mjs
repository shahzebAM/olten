import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesWorkspaceModule, workspaceNavigation } from '../src/lib/workspaceNavigation.ts';

test('module search matches every visible card label', () => {
  const labels = {
    executive: 'Executive Dashboard', customers: 'Customer Directory',
    create_os: 'Create Order Slip', sales_orders: 'O.S. Ledger',
    suppliers: 'Supplier Directory', purchase_orders: 'P.O.',
    importation: 'Importation & Receiving', inventory: 'Master Inventory',
    warehouse_ops: 'Warehouse & Cycle Counts', customer_pos: 'Customer Orders & Fulfillment',
    deliveries: 'Delivery & Proof of Delivery', generate_qr: 'QR Generator',
    finance: 'Landed Cost & Finance', books: 'Books & Reconciliation',
    service: 'Medical Device Service', ai_docs: 'AI Docs Engine',
    ai_assistant: 'Executive AI & Invoice OCR', payroll: 'Payroll Engine',
  };
  for (const [id, label] of Object.entries(labels)) {
    assert.equal(matchesWorkspaceModule(id, `  ${label.toUpperCase()}  `), true, label);
  }
});

test('module search retains navigation names, IDs and common abbreviations', () => {
  for (const item of workspaceNavigation) {
    for (const query of [item.title, item.id, item.module, '']) {
      assert.equal(matchesWorkspaceModule(item.id, query), true, `${item.id}: ${query}`);
    }
  }
  assert.equal(matchesWorkspaceModule('purchase_orders', 'PO'), true);
  assert.equal(matchesWorkspaceModule('sales_orders', 'OS Ledger'), true);
  assert.equal(matchesWorkspaceModule('generate_qr', 'qr_system'), true);
  assert.equal(matchesWorkspaceModule('books', 'unrelated module'), false);
});

test('search filters only already-authorized cards and preserves their saved order', () => {
  const allowedOrder = ['ai_docs', 'purchase_orders', 'inventory', 'generate_qr'];
  const before = [...allowedOrder];
  assert.deepEqual(allowedOrder.filter(id => matchesWorkspaceModule(id, 'QR Generator')), ['generate_qr']);
  assert.deepEqual(allowedOrder.filter(id => matchesWorkspaceModule(id, 'Executive Dashboard')), []);
  assert.deepEqual(allowedOrder.filter(id => matchesWorkspaceModule(id, '')), before);
  assert.deepEqual(allowedOrder, before);
});

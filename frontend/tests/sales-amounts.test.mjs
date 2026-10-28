import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { roundSalesLine, salesTotals } from '../src/lib/salesAmounts.ts';
const require = createRequire(import.meta.url);
const { Prisma } = require('../../backend/node_modules/@prisma/client');

test('approved decimal half-up prices preserve cents at binary floating-point boundaries', () => {
  for (const [quantity, price, expected] of [
    [1, '1.005', 1.01], [1, '2.675', 2.68], [3, '2.675', 8.03],
    [1, '10.075', 10.08], [2, '0.005', 0.01], [-1, '1.005', -1.01],
    [1000000, '1e-7', 0.1], [1, '6e-3', 0.01], [0, '10.01', 0],
  ]) assert.equal(roundSalesLine(quantity, price), expected);
});

test('line cents accumulate exactly and VAT is rounded once on the subtotal', () => {
  assert.deepEqual(salesTotals([0.1, 0.2], true), { subtotal: 0.3, vatAmount: 0.04, grandTotal: 0.34 });
  assert.deepEqual(salesTotals([roundSalesLine(1, '1.005')], true), { subtotal: 1.01, vatAmount: 0.12, grandTotal: 1.13 });
  assert.deepEqual(salesTotals([0.25], true, '0.1'), { subtotal: 0.25, vatAmount: 0.03, grandTotal: 0.28 });
  assert.deepEqual(salesTotals([roundSalesLine(1, '0.005'), roundSalesLine(1, '0.005')], false), { subtotal: 0.02, vatAmount: 0, grandTotal: 0.02 });
  assert.deepEqual(salesTotals([], true), { subtotal: 0, vatAmount: 0, grandTotal: 0 });
});

test('frontend OS/PO previews match Prisma decimal arithmetic for 240 independent price and VAT cases', () => {
  for (let i = 1; i <= 240; i++) {
    const quantity = i % 11 + 1;
    const price = `${i % 29}.${String(i * 173 % 1000).padStart(3, '0')}`;
    const expectedLine = new Prisma.Decimal(quantity).mul(price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const line = roundSalesLine(quantity, price);
    assert.equal(line, expectedLine.toNumber());
    const rate = i % 3 ? '0.12' : '0';
    const expectedVat = expectedLine.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    assert.deepEqual(salesTotals([line], true, rate), { subtotal: expectedLine.toNumber(), vatAmount: expectedVat.toNumber(), grandTotal: expectedLine.add(expectedVat).toNumber() });
  }
});

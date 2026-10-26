import { Prisma } from '@prisma/client';
import type { Tx } from './phase3.shared';
import { reportPeriod } from './books.reports';
import { postingControlCodes } from './posting-accounts';
import { manilaDay } from '../importation/importation.validation';

const Exact = Prisma.Decimal.clone({ precision: 50 });
export async function inventoryReconciliation(tx: Tx, company: string) {
  const asOf = manilaDay(new Date()),
    period = reportPeriod({ asOf });
  const [products, stocks, controls] = await Promise.all([
    // Text preserves the stored Float reference and allows invalid DB values to
    // become explicit exceptions instead of failing Prisma Float decoding.
    tx.$queryRaw<
      {
        id: number;
        sku: string;
        name: string;
        currentStock: number;
        purchasePrice: string;
        landedCostReference: Prisma.Decimal | null;
      }[]
    >`
      SELECT id,sku,name,"currentStock","purchasePrice"::text AS "purchasePrice","landedCostReference"
      FROM "Product" WHERE company=${company} ORDER BY id`,
    tx.warehouseStock.groupBy({
      by: ['productId'],
      where: { company },
      _sum: { quantity: true },
    }),
    postingControlCodes(tx, company),
  ]);
  const quantities = new Map(
    stocks.map((stock) => [stock.productId, stock._sum.quantity ?? 0]),
  );
  const rows: {
    productId: number;
    sku: string;
    productName: string;
    officeQuantity: number;
    warehouseQuantity: number;
    unitCost: string | null;
    costBasis: string;
    officeValue: string | null;
    warehouseValue: string | null;
    referenceValue: string | null;
    issue: string;
  }[] = [];
  let office = new Exact(0),
    warehouse = new Exact(0),
    invalidCosts = 0,
    zeroCosts = 0,
    negativeQuantities = 0;
  for (const product of products) {
    const officeQuantity = product.currentStock,
      warehouseQuantity = quantities.get(product.id) ?? 0;
    quantities.delete(product.id);
    if (!officeQuantity && !warehouseQuantity) continue;
    const raw = product.landedCostReference ?? product.purchasePrice;
    let unit: InstanceType<typeof Exact> | null = null;
    try {
      const value = new Exact(String(raw));
      if (value.isFinite() && value.gte(0)) unit = value;
    } catch {
      /* Invalid reference is reported, never converted to a zero value. */
    }
    const issues: string[] = [];
    if (!unit) {
      invalidCosts++;
      issues.push('Invalid or missing cost reference');
    } else if (unit.isZero()) {
      zeroCosts++;
      issues.push('Zero reference cost: review cost evidence');
    }
    if (officeQuantity < 0 || warehouseQuantity < 0) {
      negativeQuantities++;
      issues.push('Negative physical balance: review stock evidence');
    }
    const officeValue = unit
        ?.mul(officeQuantity)
        .toDecimalPlaces(2, Exact.ROUND_HALF_UP),
      warehouseValue = unit
        ?.mul(warehouseQuantity)
        .toDecimalPlaces(2, Exact.ROUND_HALF_UP);
    if (officeValue) office = office.add(officeValue);
    if (warehouseValue) warehouse = warehouse.add(warehouseValue);
    rows.push({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      officeQuantity,
      warehouseQuantity,
      unitCost: unit?.toFixed(6) ?? null,
      costBasis:
        product.landedCostReference !== null
          ? 'Approved landed reference'
          : 'Manual purchase reference',
      officeValue: officeValue?.toFixed(2) ?? null,
      warehouseValue: warehouseValue?.toFixed(2) ?? null,
      referenceValue:
        officeValue && warehouseValue
          ? officeValue.add(warehouseValue).toFixed(2)
          : null,
      issue: issues.join('; '),
    });
  }
  for (const [productId, quantity] of quantities)
    if (quantity) {
      invalidCosts++;
      rows.push({
        productId,
        sku: 'Unavailable',
        productName: 'Unmatched warehouse product reference',
        officeQuantity: 0,
        warehouseQuantity: quantity,
        unitCost: null,
        costBasis: 'Missing product',
        officeValue: '0.00',
        warehouseValue: null,
        referenceValue: null,
        issue: 'Missing company-owned product reference',
      });
    }
  const ledger = await tx.ledgerEntry.aggregate({
    where: {
      account: { company, code: { in: controls['1200'] } },
      journal: { company, status: 'POSTED', date: { lt: period.end } },
    },
    _sum: { debit: true, credit: true },
  });
  const recorded = new Exact(ledger._sum.debit ?? 0).minus(
      ledger._sum.credit ?? 0,
    ),
    reference = office.add(warehouse);
  const comparisonAvailable = invalidCosts === 0 && negativeQuantities === 0;
  return {
    company,
    currency: 'PHP',
    timeZone: 'Asia/Manila',
    generatedAt: new Date().toISOString(),
    ledgerAsOf: asOf,
    complete: true,
    comparisonAvailable,
    issues: { invalidCosts, zeroCosts, negativeQuantities },
    inventoryAccounts: controls['1200'],
    rows,
    totals: {
      officeReference: office.toFixed(2),
      warehouseReference: warehouse.toFixed(2),
      knownCombinedReference: reference.toFixed(2),
      inventoryLedger: recorded.toFixed(2),
      difference: comparisonAvailable
        ? reference.minus(recorded).toFixed(2)
        : null,
    },
    note: 'Current physical snapshot × current reference cost, rounded once per product/pool to cents. Warehouse stock already includes its reserved and blocked lots; lots are not added again. This is not historical FIFO/weighted-average valuation. A difference is a review item, not an automatic adjustment. Invalid cost/quantity evidence disables the comparison; zero references require Finance review. Ledger uses current Manila date, and all standard/configured/frozen inventory control accounts. No stock, prices or journals are changed.',
  };
}

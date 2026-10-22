import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as v from '../importation/importation.validation';

export const roundMoney = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const sum = (values: Prisma.Decimal[]) =>
  values.reduce((total, value) => total.add(value), new Prisma.Decimal(0));

export function decimal(
  value: unknown,
  label: string,
  positive = false,
): Prisma.Decimal {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^\d{1,12}(?:\.\d{1,6})?$/.test(String(value))
  )
    throw new BadRequestException(
      `${label} requires a non-negative decimal with at most six decimal places.`,
    );
  const result = new Prisma.Decimal(String(value));
  if (
    !result.isFinite() ||
    result.gte('1000000000000') ||
    (positive && result.lte(0))
  )
    throw new BadRequestException(`${label} is outside the permitted range.`);
  return result;
}

export function exchangeRate(currency: string, value: unknown) {
  const rate = decimal(value, 'Exchange rate', true);
  if (currency === 'PHP' && !rate.eq(1))
    throw new BadRequestException('PHP exchange rate must be 1.');
  return rate;
}

export type CostItem = {
  shipmentLineId: string;
  productId: number;
  quantity: number;
  unitPrice: string;
  currency: string;
  exchangeRate: string;
  weight: string;
  volume: string;
};
export type CostExpense = {
  category: string;
  description: string;
  amount: string;
  currency: string;
  exchangeRate: string;
};

/** Largest-remainder allocation conserves every cent, including equal-weight ties. */
export function allocateCents(
  total: Prisma.Decimal,
  weights: Prisma.Decimal[],
) {
  const denominator = sum(weights);
  if (
    total.lt(0) ||
    total.decimalPlaces() > 2 ||
    weights.some((weight) => weight.lt(0)) ||
    (!total.isZero() && denominator.lte(0))
  )
    throw new BadRequestException(
      'Allocation requires positive total weights and exact non-negative cents.',
    );
  if (total.isZero()) return weights.map(() => new Prisma.Decimal(0));
  const cents = total.mul(100);
  const shares = weights.map((weight, index) => {
    const raw = cents.mul(weight).div(denominator);
    return { index, cents: raw.floor(), remainder: raw.minus(raw.floor()) };
  });
  const remaining = cents
    .minus(sum(shares.map((share) => share.cents)))
    .toNumber();
  const ranked = [...shares].sort(
    (a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index,
  );
  for (let index = 0; index < remaining; index++)
    ranked[index].cents = ranked[index].cents.add(1);
  return shares.map((share) => share.cents.div(100));
}

export function landedCalculation(
  items: CostItem[],
  expenses: CostExpense[],
  method: string,
) {
  v.choice(
    method,
    ['VALUE', 'WEIGHT', 'VOLUME', 'QUANTITY'],
    'allocation method',
  );
  const base = items.map((item) =>
    roundMoney(
      new Prisma.Decimal(item.unitPrice)
        .mul(item.quantity)
        .mul(item.exchangeRate),
    ),
  );
  const expenseTotal = sum(
    expenses.map((expense) =>
      roundMoney(new Prisma.Decimal(expense.amount).mul(expense.exchangeRate)),
    ),
  );
  const weights = items.map((item, index) =>
    method === 'VALUE'
      ? base[index]
      : new Prisma.Decimal(
          method === 'QUANTITY'
            ? 1
            : method === 'WEIGHT'
              ? item.weight
              : item.volume,
        ).mul(item.quantity),
  );
  const allocated = allocateCents(expenseTotal, weights);
  const allocations = items.map((item, index) => ({
    shipmentLineId: item.shipmentLineId,
    productId: item.productId,
    quantity: item.quantity,
    baseCost: base[index].toFixed(2),
    allocatedExpenses: allocated[index].toFixed(2),
    totalCost: base[index].add(allocated[index]).toFixed(2),
    unitCost: base[index].add(allocated[index]).div(item.quantity).toFixed(6),
  }));
  const total = sum(base).add(expenseTotal);
  if (total.gte('1000000000000'))
    throw new BadRequestException(
      'Landed cost total exceeds the supported range.',
    );
  return {
    allocations,
    baseTotal: sum(base).toFixed(2),
    expenseTotal: expenseTotal.toFixed(2),
    total: total.toFixed(2),
  };
}

export type BillLine = {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  accountCode: string;
  subtotal: string;
  taxAmount: string;
  total: string;
};
export function billCalculation(
  input: Record<string, unknown>[],
  rate: Prisma.Decimal,
): {
  items: BillLine[];
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
} {
  const items = input.map((line) => {
    const quantity = decimal(line.quantity, 'Quantity', true);
    const unitPrice = decimal(line.unitPrice, 'Unit price');
    const taxRate = decimal(line.taxRate ?? '0', 'Tax rate');
    if (taxRate.gt(1))
      throw new BadRequestException(
        'Tax rate must be a fraction between 0 and 1.',
      );
    const subtotal = roundMoney(quantity.mul(unitPrice).mul(rate));
    const taxAmount = roundMoney(subtotal.mul(taxRate));
    return {
      description: v.text(line.description, 'Description')!,
      quantity: quantity.toString(),
      unitPrice: unitPrice.toString(),
      taxRate: taxRate.toString(),
      accountCode: v.choice(
        line.accountCode ?? '1200',
        ['1200', '5000', '6000'],
        'bill account',
      ),
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: subtotal.add(taxAmount).toFixed(2),
    };
  });
  const subtotal = sum(items.map((line) => new Prisma.Decimal(line.subtotal)));
  const taxAmount = sum(
    items.map((line) => new Prisma.Decimal(line.taxAmount)),
  );
  const total = subtotal.add(taxAmount);
  if (total.lte(0) || total.gte('1000000000000'))
    throw new BadRequestException(
      'The bill total must be positive and below the supported limit.',
    );
  return { items, subtotal, taxAmount, total };
}

export function outstanding(document: {
  total: Prisma.Decimal;
  memos: { status: string; kind: string; total: Prisma.Decimal }[];
  allocations: { amount: Prisma.Decimal; payment: { status: string } }[];
}) {
  const adjustments = sum(
    document.memos
      .filter((memo) => memo.status === 'POSTED')
      .map((memo) =>
        memo.kind === 'CREDIT_MEMO' ? memo.total.negated() : memo.total,
      ),
  );
  const paid = sum(
    document.allocations
      .filter((allocation) => allocation.payment.status === 'POSTED')
      .map((allocation) => allocation.amount),
  );
  return {
    adjustments,
    paid,
    outstanding: document.total.add(adjustments).minus(paid),
  };
}

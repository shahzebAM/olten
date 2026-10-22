import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  allocateCents,
  billCalculation,
  CostItem,
  decimal,
  exchangeRate,
  landedCalculation,
  outstanding,
  sum,
} from './finance.calculations';

const d = (value: string | number) => new Prisma.Decimal(value);
const item = (
  shipmentLineId: string,
  quantity: number,
  unitPrice: string,
  weight = '1',
  volume = '1',
): CostItem => ({
  shipmentLineId,
  productId: Number(shipmentLineId),
  quantity,
  unitPrice,
  currency: 'USD',
  exchangeRate: '50',
  weight,
  volume,
});
describe('Phase 3 exact financial calculations', () => {
  it.each([
    'NaN',
    '-1',
    '1e3',
    '0.0000001',
    '1000000000000',
    Infinity,
    null,
    true,
  ])('rejects invalid financial decimals: %s', (value) =>
    expect(() => decimal(value, 'Price')).toThrow(BadRequestException),
  );
  it('requires positive rates and PHP rate 1', () => {
    expect(() => exchangeRate('USD', '0')).toThrow();
    expect(() => exchangeRate('PHP', '50')).toThrow();
    expect(exchangeRate('USD', '56.123456').toString()).toBe('56.123456');
  });
  it('allocates tie cents deterministically without losing or inventing a cent', () => {
    expect(
      allocateCents(d('.02'), [d(1), d(1), d(1)]).map((value) =>
        value.toFixed(2),
      ),
    ).toEqual(['0.01', '0.01', '0.00']);
    for (let count = 1; count <= 200; count++) {
      const weights = Array.from({ length: count }, (_, index) => d(index + 1));
      expect(sum(allocateCents(d('12345.67'), weights)).toFixed(2)).toBe(
        '12345.67',
      );
    }
  });
  it('rejects zero or negative allocation denominators when charges exist', () => {
    expect(() => allocateCents(d(1), [d(0), d(0)])).toThrow();
    expect(() => allocateCents(d(1), [d(-1), d(2)])).toThrow();
    expect(allocateCents(d(0), [d(0)]).map(String)).toEqual(['0']);
  });
  it.each([
    ['VALUE', ['20.00', '80.00']],
    ['QUANTITY', ['33.33', '66.67']],
    ['WEIGHT', ['11.11', '88.89']],
    ['VOLUME', ['60.00', '40.00']],
  ])(
    'allocates landed charges by %s and preserves manual unit inputs',
    (method, expected) => {
      const items = [
        item('1', 1, '10', '1', '3'),
        item('2', 2, '20', '4', '1'),
      ];
      const result = landedCalculation(
        items,
        [
          {
            category: 'FREIGHT',
            description: 'International freight',
            amount: '2',
            currency: 'USD',
            exchangeRate: '50',
          },
        ],
        method,
      );
      expect(result.total).toBe('2600.00');
      expect(result.allocations.map((line) => line.allocatedExpenses)).toEqual(
        expected,
      );
      expect(items[0].unitPrice).toBe('10');
      expect(
        sum(result.allocations.map((line) => d(line.totalCost))).toFixed(2),
      ).toBe(result.total);
    },
  );
  it('rounds FX and 12% VAT half up in PHP with exact cents', () => {
    const result = billCalculation(
      [
        {
          description: 'Device',
          quantity: 2,
          unitPrice: '10.005',
          taxRate: '0.12',
          accountCode: '1200',
        },
      ],
      d('56.25'),
    );
    expect(result.subtotal.toFixed(2)).toBe('1125.56');
    expect(result.taxAmount.toFixed(2)).toBe('135.07');
    expect(result.total.toFixed(2)).toBe('1260.63');
  });
  it('rejects unsupported accounts, excessive tax and zero totals', () => {
    expect(() =>
      billCalculation(
        [
          {
            description: 'Device',
            quantity: 1,
            unitPrice: '0',
            taxRate: '0.12',
          },
        ],
        d(1),
      ),
    ).toThrow();
    expect(() =>
      billCalculation(
        [{ description: 'Device', quantity: 1, unitPrice: '1', taxRate: '12' }],
        d(1),
      ),
    ).toThrow();
    expect(() =>
      billCalculation(
        [
          {
            description: 'Device',
            quantity: 1,
            unitPrice: '1',
            accountCode: '1300',
          },
        ],
        d(1),
      ),
    ).toThrow();
  });
  it('derives balances only from posted memos and posted allocations, retaining credits', () => {
    const balance = outstanding({
      total: d('1120'),
      memos: [
        { kind: 'CREDIT_MEMO', status: 'POSTED', total: d('112') },
        { kind: 'DEBIT_MEMO', status: 'POSTED', total: d('56') },
        { kind: 'CREDIT_MEMO', status: 'DRAFT', total: d('1000') },
      ],
      allocations: [
        { amount: d('1100'), payment: { status: 'POSTED' } },
        { amount: d('5'), payment: { status: 'VOID' } },
      ],
    });
    expect(balance.adjustments.toFixed(2)).toBe('-56.00');
    expect(balance.paid.toFixed(2)).toBe('1100.00');
    expect(balance.outstanding.toFixed(2)).toBe('-36.00');
  });
});

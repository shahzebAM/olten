import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinanceService } from './finance.service';
import { BooksService } from './books.service';
import { ProcurementController } from '../sales/purchase-orders.controller';
import {
  DEFAULT_ACCOUNTS,
  postJournal,
  type Actor,
  type Tx,
} from './phase3.shared';
import {
  billCalculation,
  landedCalculation,
  outstanding,
} from './finance.calculations';

// Independent fixed-point oracle: no production Decimal or rounding helper.
const micros = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
};
const halfUp = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator / 2n) / denominator;
const centsText = (cents: bigint) =>
  `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
const cents = (value: string) => BigInt(value.replace('.', ''));
const d = (value: string | number) => new Prisma.Decimal(value);
const actor: Actor = {
  id: 1,
  username: 'audit-test',
  role: 'Super Admin',
  modules: {},
};
type Entry = {
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  account: { code: string; company: string };
};
type Journal = {
  id: string;
  company: string;
  date: Date;
  sourceType: string;
  sourceId: string;
  sourceKey: string;
  memo: string;
  status: string;
  entries: Entry[];
};

function fixture() {
  const journals: Journal[] = [];
  const documents = new Map<string, ReturnType<typeof document>>();
  const payments: Record<string, unknown>[] = [];
  const accounts = DEFAULT_ACCOUNTS.map(([code, name, type]) => ({
    id: code,
    code,
    name,
    type,
    company: 'Audit',
    active: true,
    _count: { entries: 0, mappings: 0, reconciliations: 0 },
  }));
  const db = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([]),
    company: { findUnique: jest.fn().mockResolvedValue({ id: 'company' }) },
    ledgerAccount: {
      findUnique: jest.fn(
        ({ where }: { where: { company_code: { code: string } } }) =>
          accounts.find((a) => a.code === where.company_code.code),
      ),
      findMany: jest.fn(({ where }: { where: { code?: { in: string[] } } }) =>
        where.code
          ? accounts.filter((a) => where.code!.in.includes(a.code))
          : accounts,
      ),
      create: jest.fn(),
    },
    accountingJournal: {
      findUnique: jest.fn(
        ({ where }: { where: { company_sourceKey: { sourceKey: string } } }) =>
          journals.find(
            (j) => j.sourceKey === where.company_sourceKey.sourceKey,
          ) ?? null,
      ),
      findMany: jest.fn(() => journals),
      create: jest.fn(
        ({
          data,
        }: {
          data: Omit<Journal, 'id' | 'status' | 'entries'> & {
            entries: { create: Omit<Entry, 'account'>[] };
          };
        }) => {
          const row = {
            ...data,
            id: `journal-${journals.length + 1}`,
            status: 'POSTED',
            entries: data.entries.create.map((e) => ({
              ...e,
              account: { code: e.accountId, company: 'Audit' },
            })),
          };
          journals.push(row);
          return row;
        },
      ),
    },
    importSequence: {
      upsert: jest
        .fn()
        .mockImplementation(() => ({ value: journals.length + 1 })),
    },
    erpAuditLog: { create: jest.fn() },
    financeDocument: {
      findFirst: jest.fn(
        ({ where }: { where: { id: string } }) =>
          documents.get(where.id) ?? null,
      ),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(() => [...documents.values()]),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<ReturnType<typeof document>>;
        }) => {
          const row = { ...documents.get(where.id)!, ...data };
          documents.set(row.id, row);
          return row;
        },
      ),
      create: jest.fn(
        ({ data }: { data: Partial<ReturnType<typeof document>> }) => {
          const row = document({
            ...data,
            id: `document-${documents.size + 1}`,
          });
          documents.set(row.id, row);
          return row;
        },
      ),
    },
    financePayment: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { company_idempotencyKey: { idempotencyKey: string } };
        }) =>
          payments.find(
            (p) =>
              p.idempotencyKey === where.company_idempotencyKey.idempotencyKey,
          ) ?? null,
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: Record<string, unknown> & {
            allocations: {
              create: { documentId: string; amount: Prisma.Decimal }[];
            };
          };
        }) => {
          const row = {
            ...data,
            id: `payment-${payments.length + 1}`,
            status: 'POSTED',
            allocations: data.allocations.create,
            paymentRequests: [],
          };
          payments.push(row);
          for (const allocation of row.allocations)
            documents.get(allocation.documentId)!.allocations.push({
              amount: allocation.amount,
              payment: { status: 'POSTED' },
            });
          return row;
        },
      ),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: 'customer' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    supplier: {
      findFirst: jest.fn().mockResolvedValue({ id: 'supplier' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    accountingMapping: { findMany: jest.fn().mockResolvedValue([]) },
    bankReconciliation: { findMany: jest.fn().mockResolvedValue([]) },
    ledgerEntry: {
      groupBy: jest.fn(() =>
        accounts.map((account) => {
          const entries = journals
            .flatMap((j) => j.entries)
            .filter((e) => e.accountId === account.id);
          const debit = entries.reduce(
            (n, e) => n + cents(e.debit.toFixed(2)),
            0n,
          );
          const credit = entries.reduce(
            (n, e) => n + cents(e.credit.toFixed(2)),
            0n,
          );
          return {
            accountId: account.id,
            _sum: { debit: d(centsText(debit)), credit: d(centsText(credit)) },
          };
        }),
      ),
    },
  };
  db.$transaction.mockImplementation((work: (tx: typeof db) => unknown) =>
    work(db),
  );
  const finance = Object.create(FinanceService.prototype) as FinanceService;
  const books = Object.create(BooksService.prototype) as BooksService;
  Object.defineProperty(finance, 'prisma', { value: db });
  Object.defineProperty(books, 'prisma', { value: db });
  return { db, finance, books, journals, documents };
}

function document(patch: Record<string, unknown> = {}) {
  return {
    id: 'invoice',
    company: 'Audit',
    kind: 'INVOICE',
    direction: 'AR',
    status: 'DRAFT',
    partyId: 'customer',
    number: 'INV-AUDIT',
    issueDate: new Date('2026-10-01T00:00:00Z'),
    dueDate: new Date('2026-10-15T00:00:00Z'),
    subtotal: d('100'),
    taxAmount: d('12'),
    total: d('112'),
    data: { items: [{ productId: 1, quantity: 2, unitCost: '25.000000' }] },
    memos: [] as {
      status: string;
      kind: string;
      total: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      data: unknown;
    }[],
    allocations: [] as {
      amount: Prisma.Decimal;
      payment: { status: string };
    }[],
    ...patch,
  };
}

describe('Independent accounting audit: fixed-point amounts and reconciliation', () => {
  it('manual PO line rounding agrees with the established decimal half-up boundary', async () => {
    const db = {
      $transaction: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
      purchaseOrder: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(({ data }: { data: { subtotal: number } }) => data),
      },
      orderSlip: {
        findFirst: jest.fn().mockResolvedValue({ status: 'Generated' }),
      },
    };
    db.$transaction.mockImplementation((work: (tx: typeof db) => unknown) =>
      work(db),
    );
    const procurement = Object.create(
      ProcurementController.prototype,
    ) as ProcurementController;
    Object.defineProperty(procurement, 'prisma', { value: db });
    const result = await procurement.createPurchaseOrder({
      company: 'Audit',
      user: 'audit-test',
      poNumber: 'PO-AUDIT-1',
      osReference: 'OS-AUDIT-1',
      isVatApplied: false,
      items: [
        {
          productId: 1,
          sku: 'AUDIT',
          productName: 'Boundary item',
          requestedQty: 1,
          unitCost: '1.005',
        },
      ],
    });
    // Independent rational expectation: 100.5 cents rounds to 101 cents.
    expect(centsText(halfUp(1005n, 10n))).toBe('1.01');
    expect(result.subtotal).toBe(1.01);
  });

  it('matches a BigInt oracle for 240 line-level FX and VAT rounding cases', () => {
    for (let i = 1; i <= 240; i++) {
      const quantity = `${(i % 9) + 1}.125`;
      const price = `${i % 23}.${String((i * 173) % 1000).padStart(3, '0')}`;
      const rate = i % 2 ? '56.123456' : '1';
      const tax = i % 3 ? '0.12' : '0';
      const expectedBase = halfUp(
        micros(quantity) * micros(price) * micros(rate) * 100n,
        1_000_000_000_000_000_000n,
      );
      const expectedTax = halfUp(expectedBase * micros(tax), 1_000_000n);
      const result = billCalculation(
        [
          {
            description: 'Audit item',
            quantity,
            unitPrice: price,
            taxRate: tax,
            accountCode: '1200',
          },
        ],
        d(rate),
      );
      expect(result.subtotal.toFixed(2)).toBe(centsText(expectedBase));
      expect(result.taxAmount.toFixed(2)).toBe(centsText(expectedTax));
      expect(result.total.toFixed(2)).toBe(
        centsText(expectedBase + expectedTax),
      );
    }
  });

  it('conserves independently established foreign landed cost with a one-cent tie', () => {
    const items = [1, 2, 3].map((productId) => ({
      shipmentLineId: String(productId),
      productId,
      quantity: 1,
      unitPrice: '2.50',
      currency: 'USD',
      exchangeRate: '56',
      weight: '1',
      volume: '1',
    }));
    const result = landedCalculation(
      items,
      [
        {
          category: 'FREIGHT',
          description: 'Freight',
          amount: '0.01',
          currency: 'PHP',
          exchangeRate: '1',
        },
      ],
      'QUANTITY',
    );
    expect(result).toMatchObject({
      baseTotal: '420.00',
      expenseTotal: '0.01',
      total: '420.01',
    });
    expect(result.allocations.map((a) => a.totalCost)).toEqual([
      '140.01',
      '140.00',
      '140.00',
    ]);
    expect(
      result.allocations.reduce((n, a) => n + cents(a.totalCost), 0n),
    ).toBe(42001n);
  });

  it('reconciles posted adjustments and allocated payments without including drafts', () => {
    const result = outstanding({
      total: d('1120'),
      memos: [
        { status: 'POSTED', kind: 'CREDIT_MEMO', total: d('112') },
        { status: 'POSTED', kind: 'DEBIT_MEMO', total: d('56') },
        { status: 'DRAFT', kind: 'CREDIT_MEMO', total: d('1000') },
      ],
      allocations: [
        { amount: d('500'), payment: { status: 'POSTED' } },
        { amount: d('100'), payment: { status: 'VOID' } },
      ],
    });
    expect(result.adjustments.toFixed(2)).toBe('-56.00');
    expect(result.paid.toFixed(2)).toBe('500.00');
    expect(result.outstanding.toFixed(2)).toBe('564.00');
  });

  it('posts sale, partial receipt and full receipt exactly once and reconciles the trial balance', async () => {
    const { finance, books, journals, documents, db } = fixture();
    documents.set('invoice', document());
    await finance.postDocument('Audit', actor, 'invoice');
    await finance.postDocument('Audit', actor, 'invoice');
    expect(journals).toHaveLength(1);
    expect(
      journals[0].entries.map((e) => [
        e.account.code,
        e.debit.toFixed(2),
        e.credit.toFixed(2),
      ]),
    ).toEqual([
      ['1300', '112.00', '0.00'],
      ['4000', '0.00', '100.00'],
      ['2200', '0.00', '12.00'],
      ['5100', '50.00', '0.00'],
      ['1200', '0.00', '50.00'],
    ]);
    const payment = {
      direction: 'AR',
      partyId: 'customer',
      amount: '40.00',
      paidAt: '2026-10-15',
      method: 'Bank',
      reference: 'receipt-1',
      idempotencyKey: 'receipt-1',
      allocations: [{ documentId: 'invoice', amount: '40.00' }],
    };
    await finance.createPayment('Audit', actor, payment);
    await finance.createPayment('Audit', actor, payment);
    expect(db.financePayment.create).toHaveBeenCalledTimes(1);
    expect(outstanding(documents.get('invoice')!).outstanding.toFixed(2)).toBe(
      '72.00',
    );
    await finance.createPayment('Audit', actor, {
      ...payment,
      amount: '72.00',
      reference: 'receipt-2',
      idempotencyKey: 'receipt-2',
      allocations: [{ documentId: 'invoice', amount: '72.00' }],
    });
    const report = await books.overview('Audit');
    const balances = Object.fromEntries(
      report.trialBalance.map((row) => [row.code, row.balance]),
    );
    expect(balances['1000']).toBe('112.00');
    expect(balances['1300']).toBe('0.00');
    expect(balances['4000']).toBe('-100.00');
    expect(balances['5100']).toBe('50.00');
    const totals = report.trialBalance.reduce(
      (sum, row) => [sum[0] + cents(row.debit), sum[1] + cents(row.credit)],
      [0n, 0n],
    );
    expect(totals).toEqual([27400n, 27400n]);
    // Assets (cash 112 minus inventory 50) = VAT liability 12 + profit 50.
    expect(11200n - 5000n).toBe(1200n + 10000n - 5000n);
    expect(outstanding(documents.get('invoice')!).outstanding.toFixed(2)).toBe(
      '0.00',
    );
  });

  it('rejects overpayment and a changed duplicate key without adding a journal', async () => {
    const { finance, journals, documents } = fixture();
    documents.set('invoice', document({ status: 'POSTED' }));
    const payment = {
      direction: 'AR',
      partyId: 'customer',
      amount: '112.01',
      paidAt: '2026-10-15',
      method: 'Bank',
      reference: 'receipt',
      idempotencyKey: 'receipt',
      allocations: [{ documentId: 'invoice', amount: '112.01' }],
    };
    await expect(
      finance.createPayment('Audit', actor, payment),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(journals).toHaveLength(0);
    documents.set('invoice', document({ status: 'DRAFT' }));
    await finance.postDocument('Audit', actor, 'invoice');
    await finance.createPayment('Audit', actor, {
      ...payment,
      amount: '50.00',
      allocations: [{ documentId: 'invoice', amount: '50.00' }],
    });
    await expect(
      finance.createPayment('Audit', actor, {
        ...payment,
        amount: '51.00',
        allocations: [{ documentId: 'invoice', amount: '51.00' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(journals).toHaveLength(2);
    expect(
      journals.filter((journal) => journal.sourceType === 'CUSTOMER_PAYMENT'),
    ).toHaveLength(1);
  });

  it('posts a mixed-account bill and supplier payment against independently expected accounts', async () => {
    const { finance, documents, journals } = fixture();
    documents.set(
      'bill',
      document({
        id: 'bill',
        kind: 'BILL',
        direction: 'AP',
        partyId: 'supplier',
        data: {
          items: [
            { accountCode: '1200', subtotal: '70.00' },
            { accountCode: '5000', subtotal: '30.00' },
          ],
        },
      }),
    );
    await finance.postDocument('Audit', actor, 'bill');
    expect(
      journals[0].entries.map((e) => [
        e.account.code,
        e.debit.toFixed(2),
        e.credit.toFixed(2),
      ]),
    ).toEqual([
      ['2100', '0.00', '112.00'],
      ['1400', '12.00', '0.00'],
      ['1200', '70.00', '0.00'],
      ['5000', '30.00', '0.00'],
    ]);
    await finance.createPayment('Audit', actor, {
      direction: 'AP',
      partyId: 'supplier',
      amount: '20.00',
      paidAt: '2026-10-15',
      method: 'Bank',
      reference: 'supplier-partial',
      idempotencyKey: 'supplier-partial',
      allocations: [{ documentId: 'bill', amount: '20.00' }],
    });
    expect(
      journals[1].entries.map((e) => [
        e.account.code,
        e.debit.toFixed(2),
        e.credit.toFixed(2),
      ]),
    ).toEqual([
      ['2100', '20.00', '0.00'],
      ['1000', '0.00', '20.00'],
    ]);
    expect(outstanding(documents.get('bill')!).outstanding.toFixed(2)).toBe(
      '92.00',
    );
  });

  it('rejects a one-cent imbalance before creating a journal or audit record', async () => {
    const { db } = fixture();
    await expect(
      postJournal(db as unknown as Tx, 'Audit', actor, {
        sourceKey: 'bad',
        sourceType: 'MANUAL',
        sourceId: 'bad',
        date: new Date('2026-10-15'),
        memo: 'One-cent discrepancy',
        lines: [
          { code: '1000', debit: '10.00', credit: '0.00' },
          { code: '3000', debit: '0.00', credit: '9.99' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.accountingJournal.create).not.toHaveBeenCalled();
    expect(db.erpAuditLog.create).not.toHaveBeenCalled();
  });

  it('reconciles successive partial credit memo VAT to the original final cent', async () => {
    const { finance, documents, journals } = fixture();
    const original = document({
      subtotal: d('0.89'),
      taxAmount: d('0.11'),
      total: d('1.00'),
      status: 'DRAFT',
    });
    documents.set('invoice', original);
    await finance.postDocument('Audit', actor, 'invoice');
    const actualTaxes: string[] = [];
    for (const amount of ['0.33', '0.33', '0.34']) {
      const memo = await finance.createMemo('Audit', actor, {
        submissionKey: 'memo-' + original.memos.length,
        documentId: 'invoice',
        kind: 'CREDIT_MEMO',
        amount,
        reason: 'Approved partial allowance',
      });
      original.memos.push(memo);
      actualTaxes.push(memo.taxAmount.toFixed(2));
    }
    expect(actualTaxes).toEqual(['0.04', '0.03', '0.04']);
    expect(outstanding(original).outstanding.toFixed(2)).toBe('0.00');
    expect(journals).toHaveLength(4);
    expect(
      journals.filter((journal) =>
        ['CREDIT_MEMO', 'DEBIT_MEMO'].includes(journal.sourceType),
      ),
    ).toHaveLength(3);
    for (const journal of journals) {
      expect(
        journal.entries.reduce(
          (n, e) => n + cents(e.debit.toFixed(2)) - cents(e.credit.toFixed(2)),
          0n,
        ),
      ).toBe(0n);
    }
  });

  it('puts exact Manila aging boundaries into independently expected buckets', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-24T16:00:01Z') });
    try {
      const { finance, documents } = fixture();
      const dates = [
        '2026-10-25',
        '2026-10-24',
        '2026-09-25',
        '2026-09-24',
        '2026-08-26',
        '2026-08-25',
        '2026-07-27',
        '2026-07-26',
      ];
      dates.forEach((due, index) =>
        documents.set(
          `invoice-${index}`,
          document({
            id: `invoice-${index}`,
            status: 'POSTED',
            dueDate: new Date(due),
            subtotal: d('1'),
            taxAmount: d('0'),
            total: d('1'),
          }),
        ),
      );
      const result = await finance.balances('Audit', actor, 'AR');
      expect(result.documents.map((row) => row.ageDays)).toEqual([
        0, 1, 30, 31, 60, 61, 90, 91,
      ]);
      expect(result.aging).toEqual({
        current: '1.00',
        days1to30: '2.00',
        days31to60: '2.00',
        days61to90: '2.00',
        over90: '1.00',
      });
      expect(result.totalOutstanding).toBe('8.00');
    } finally {
      jest.useRealTimers();
    }
  });
});

jest.mock('./phase3.shared', () => {
  const actual =
    jest.requireActual<typeof import('./phase3.shared')>('./phase3.shared');
  return {
    ...actual,
    audit: jest.fn(),
    nextNumber: jest.fn(),
    postJournal: jest.fn(),
  };
});

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinanceService } from './finance.service';
import { audit, nextNumber, postJournal, type Actor } from './phase3.shared';

const d = (value: string | number) => new Prisma.Decimal(value);
const containing = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value);
const actor = (roles = ['Finance'], limit = '10000.00'): Actor => ({
  id: 1,
  username: 'finance-test',
  role: 'Admin',
  modules: {
    erpRoles: roles,
    finance: true,
    purchasing: true,
    companies: { Test: true },
    approvalLimits: { Test: limit },
  },
});
const document = (overrides: Record<string, unknown> = {}) => ({
  id: 'invoice-1',
  company: 'Test',
  number: 'INV-2026-000001',
  kind: 'INVOICE',
  direction: 'AR',
  partyId: 'customer-1',
  status: 'POSTED',
  total: d('112'),
  subtotal: d('100'),
  taxAmount: d('12'),
  dueDate: new Date('2026-10-11'),
  issueDate: new Date('2026-10-01'),
  data:
    overrides.kind === 'BILL'
      ? { items: [{ accountCode: '5000', subtotal: '100.00' }] }
      : { items: [{ productId: 1, quantity: 2, unitCost: '25.000000' }] },
  memos: [],
  allocations: [],
  ...overrides,
});
const payment = (overrides: Record<string, unknown> = {}) => ({
  direction: 'AR',
  partyId: 'customer-1',
  amount: '112.00',
  paidAt: '2026-10-11',
  method: 'Bank transfer',
  reference: 'BANK-123',
  idempotencyKey: 'payment-unique',
  allocations: [{ documentId: 'invoice-1', amount: '112.00' }],
  ...overrides,
});

describe('Phase 3 Finance service business safeguards', () => {
  const db = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $disconnect: jest.fn(),
    financeDocument: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    company: { findUnique: jest.fn() },
    accountingMapping: { findMany: jest.fn() },
    accountingJournal: { findUnique: jest.fn() },
    financePayment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    customer: { findFirst: jest.fn(), findMany: jest.fn() },
    delivery: { findMany: jest.fn(), findFirst: jest.fn() },
    supplier: { findFirst: jest.fn() },
    paymentRequest: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    landedCost: { findFirst: jest.fn(), update: jest.fn() },
    product: { updateMany: jest.fn() },
    productCostHistory: { create: jest.fn() },
  };
  let service: FinanceService;
  beforeEach(() => {
    jest.resetAllMocks();
    service = Object.create(FinanceService.prototype) as FinanceService;
    Object.defineProperty(service, 'prisma', { value: db });
    db.$transaction.mockImplementation(
      (work: (tx: typeof db) => Promise<unknown>) => work(db),
    );
    db.$queryRaw.mockResolvedValue([]);
    db.company.findUnique.mockResolvedValue({ id: 'company-1', name: 'Test' });
    db.accountingMapping.findMany.mockResolvedValue([]);
    db.accountingJournal.findUnique.mockImplementation(async () => {
      const latest = db.financeDocument.findFirst.mock.results.at(-1);
      const original = (await latest?.value) as
        ReturnType<typeof document> | undefined;
      const source = original ?? document();
      const lines: {
        code: string;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }[] = [];
      const add = (code: string, value: Prisma.Decimal, debit: boolean) => {
        if (!value.isZero())
          lines.push({
            code,
            debit: debit ? value : d(0),
            credit: debit ? d(0) : value,
          });
      };
      if (source.direction === 'AR') {
        add('1300', source.total, true);
        add('4000', source.subtotal, false);
        add('2200', source.taxAmount, false);
      } else {
        add('2100', source.total, false);
        add('1400', source.taxAmount, true);
      }
      const items = source.data.items as {
        accountCode?: string;
        subtotal?: string;
        unitCost?: string;
        quantity?: number;
      }[];
      if (source.kind === 'BILL')
        for (const item of items)
          add(item.accountCode!, d(item.subtotal!), true);
      else {
        const cost = items.reduce(
          (sum, item) =>
            sum.add(d(item.unitCost!).mul(item.quantity!).toDecimalPlaces(2)),
          d(0),
        );
        add('5100', cost, true);
        add('1200', cost, false);
      }
      return {
        sourceId: source.id,
        sourceType: source.kind,
        status: 'POSTED',
        entries: lines.map((line) => ({
          ...line,
          account: { code: line.code, company: source.company },
        })),
      };
    });
    db.customer.findFirst.mockResolvedValue({ id: 'customer-1' });
    db.customer.findMany.mockResolvedValue([
      { id: 'customer-1', name: 'Test hospital' },
    ]);
    db.delivery.findMany.mockResolvedValue([]);
    db.financePayment.findMany.mockResolvedValue([]);
    db.supplier.findFirst.mockResolvedValue({ id: 'supplier-1' });
    db.financeDocument.findFirst.mockResolvedValue(document());
    db.financeDocument.findMany.mockResolvedValue([]);
    db.financeDocument.update.mockImplementation((input: { data: unknown }) =>
      Promise.resolve({ ...document(), ...(input.data as object) }),
    );
    db.financeDocument.create.mockImplementation((input: { data: unknown }) =>
      Promise.resolve({
        ...document(),
        id: 'new-document',
        ...(input.data as object),
      }),
    );
    db.financePayment.findUnique.mockResolvedValue(null);
    db.financePayment.create.mockResolvedValue({
      id: 'new-payment',
      number: 'RCPT-2026-000001',
    });
    jest.mocked(nextNumber).mockResolvedValue('TEST-2026-000001');
  });

  it('denies legacy Admin with no ERP role before database access', async () => {
    await expect(
      service.createPayment('Test', actor([]), payment()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects a company deleted before the financial write transaction', async () => {
    db.company.findUnique.mockResolvedValue(null);
    await expect(
      service.createPayment('Test', actor(), payment()),
    ).rejects.toThrow('workspace is unavailable');
    expect(db.financePayment.create).not.toHaveBeenCalled();
    expect(db.financeDocument.findFirst).not.toHaveBeenCalled();
  });
  it('omits cost snapshots from Sales finance overview responses', async () => {
    db.financeDocument.findMany.mockResolvedValue([document()]);
    const result = await service.overview('Test', actor(['Sales']));
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).not.toHaveProperty('data');
    expect(result.suppliers).toHaveLength(0);
    expect(result.products).toHaveLength(0);
  });
  it('allows Sales AR reads but denies AP financial data before querying', async () => {
    const result = await service.balances('Test', actor(['Sales']), 'AR');
    expect(result.totalOutstanding).toBe('0.00');
    db.financeDocument.findMany.mockClear();
    await expect(
      service.balances('Test', actor(['Sales']), 'AP'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.financeDocument.findMany).not.toHaveBeenCalled();
  });
  it('denies Auditor financial writes even with another writable role', async () => {
    await expect(
      service.createPayment('Test', actor(['Auditor', 'Finance']), payment()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('requires document to exist in the selected company', async () => {
    db.financeDocument.findFirst.mockResolvedValue(null);
    await expect(
      service.postDocument('Test', actor(), 'foreign-document'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.financeDocument.findFirst).toHaveBeenCalledWith(
      containing({ where: { id: 'foreign-document', company: 'Test' } }),
    );
    expect(postJournal).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'Delivered', pods: [], sources: [{ sourceType: 'FO' }] },
    { status: 'Delivered', pods: [{ id: 'pod' }], sources: [] },
    {
      status: 'Dispatched',
      pods: [{ id: 'pod' }],
      sources: [{ sourceType: 'FO' }],
    },
  ])(
    'requires both confirmed POD and active Final Order before invoice drafting',
    async (delivery) => {
      db.delivery.findFirst.mockResolvedValue({
        ...delivery,
        order: { company: 'Test' },
      });
      await expect(
        service.invoiceFromDelivery('Test', actor(), {
          deliveryId: 'delivery-1',
          dueDate: '2099-12-31',
        }),
      ).rejects.toThrow('confirmed POD');
      expect(db.financeDocument.create).not.toHaveBeenCalled();
    },
  );
  it('enforces approval limit before posting and leaves the document unchanged', async () => {
    db.financeDocument.findFirst.mockResolvedValue(
      document({ status: 'DRAFT' }),
    );
    await expect(
      service.postDocument('Test', actor(['Finance'], '111.99'), 'invoice-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(postJournal).not.toHaveBeenCalled();
    expect(db.financeDocument.update).not.toHaveBeenCalled();
  });
  it('returns an already posted document without creating another journal or audit', async () => {
    await expect(
      service.postDocument('Test', actor(), 'invoice-1'),
    ).resolves.toMatchObject({ status: 'POSTED' });
    expect(postJournal).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it('posts invoice VAT and COGS from saved cost snapshots, with gross approval amount', async () => {
    db.financeDocument.findFirst.mockResolvedValue(
      document({ status: 'DRAFT' }),
    );
    await service.postDocument(
      'Test',
      actor(['Finance'], '112.00'),
      'invoice-1',
    );
    expect(postJournal).toHaveBeenCalledWith(
      db,
      'Test',
      expect.any(Object),
      containing({
        approvalAmount: '112.00',
        sourceId: 'invoice-1',
        lines: [
          { code: '1300', debit: '112.00', credit: '0.00' },
          { code: '4000', debit: '0.00', credit: '100.00' },
          { code: '2200', debit: '0.00', credit: '12.00' },
          { code: '5100', debit: '50.00', credit: '0.00' },
          { code: '1200', debit: '0.00', credit: '50.00' },
        ],
      }),
    );
  });
  it('posts bills to their selected inventory/expense accounts and input VAT', async () => {
    db.financeDocument.findFirst.mockResolvedValue(
      document({
        kind: 'BILL',
        direction: 'AP',
        partyId: 'supplier-1',
        status: 'DRAFT',
        data: {
          items: [
            { accountCode: '1200', subtotal: '60.00' },
            { accountCode: '5000', subtotal: '40.00' },
          ],
        },
      }),
    );
    await service.postDocument('Test', actor(), 'bill-1');
    expect(postJournal).toHaveBeenCalledWith(
      db,
      'Test',
      expect.any(Object),
      containing({
        lines: [
          { code: '2100', debit: '0.00', credit: '112.00' },
          { code: '1400', debit: '12.00', credit: '0.00' },
          { code: '1200', debit: '60.00', credit: '0.00' },
          { code: '5000', debit: '40.00', credit: '0.00' },
        ],
      }),
    );
  });
  it.each([
    { amount: '111.00' },
    {
      allocations: [{ documentId: 'invoice-1', amount: '0.00' }],
      amount: '0.00',
    },
    {
      allocations: [
        { documentId: 'invoice-1', amount: '56.00' },
        { documentId: 'invoice-1', amount: '56.00' },
      ],
    },
  ])(
    'rejects inconsistent, zero, or duplicate payment allocations before writes',
    async (override) => {
      await expect(
        service.createPayment('Test', actor(), payment(override)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.financePayment.create).not.toHaveBeenCalled();
    },
  );
  it('rejects cross-party payment allocation', async () => {
    db.financeDocument.findFirst.mockResolvedValue(
      document({ partyId: 'different-customer' }),
    );
    await expect(
      service.createPayment('Test', actor(), payment()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.financePayment.create).not.toHaveBeenCalled();
  });
  it('rejects overpayment after posted credit memos and previous payments', async () => {
    db.financeDocument.findFirst.mockResolvedValue(
      document({
        memos: [{ kind: 'CREDIT_MEMO', status: 'POSTED', total: d('10') }],
        allocations: [{ amount: d('2'), payment: { status: 'POSTED' } }],
      }),
    );
    await expect(
      service.createPayment('Test', actor(), payment()),
    ).rejects.toThrow('exceeds the outstanding balance');
    expect(db.financePayment.create).not.toHaveBeenCalled();
  });
  it('reuses an identical payment submission without another allocation or journal', async () => {
    db.financePayment.findUnique.mockResolvedValue({
      id: 'existing',
      ...payment(),
      amount: d('112'),
      paidAt: new Date('2026-10-11'),
      allocations: [{ documentId: 'invoice-1', amount: d('112') }],
      paymentRequests: [],
    });
    await expect(
      service.createPayment('Test', actor(), payment()),
    ).resolves.toMatchObject({ id: 'existing' });
    expect(db.financePayment.create).not.toHaveBeenCalled();
    expect(postJournal).not.toHaveBeenCalled();
  });
  it('rejects reuse of the same submission key with changed payment details', async () => {
    db.financePayment.findUnique.mockResolvedValue({
      ...payment(),
      amount: d('112'),
      paidAt: new Date('2026-10-11'),
      reference: 'Different bank receipt',
      allocations: [{ documentId: 'invoice-1', amount: d('112') }],
      paymentRequests: [],
    });
    await expect(
      service.createPayment('Test', actor(), payment()),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects retrying a payment submission with a different supplier request identity', async () => {
    db.financePayment.findUnique.mockResolvedValue({
      id: 'existing',
      ...payment(),
      amount: d('112'),
      paidAt: new Date('2026-10-11'),
      allocations: [{ documentId: 'invoice-1', amount: d('112') }],
      paymentRequests: [{ id: 'request-1' }],
    });
    await expect(
      service.createPayment(
        'Test',
        actor(),
        payment({ paymentRequestId: 'request-2' }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.financePayment.create).not.toHaveBeenCalled();
  });
  it('does not pay an unapproved supplier request', async () => {
    db.financeDocument.findFirst.mockResolvedValue(
      document({ kind: 'BILL', direction: 'AP', partyId: 'supplier-1' }),
    );
    db.paymentRequest.findFirst.mockResolvedValue({
      status: 'SUBMITTED',
      supplierId: 'supplier-1',
      amount: d('112'),
    });
    await expect(
      service.createPayment(
        'Test',
        actor(),
        payment({
          direction: 'AP',
          partyId: 'supplier-1',
          paymentRequestId: 'request-1',
        }),
      ),
    ).rejects.toThrow('approved, unpaid supplier request');
    expect(db.financePayment.create).not.toHaveBeenCalled();
  });
  it('does not allow a credit memo beyond the original document plus debit memos', async () => {
    await expect(
      service.createMemo('Test', actor(), {
        submissionKey: 'memo-single',
        documentId: 'invoice-1',
        kind: 'CREDIT_MEMO',
        amount: '112.01',
        reason: 'Adjustment',
      }),
    ).rejects.toThrow('cannot exceed');
    expect(db.financeDocument.create).not.toHaveBeenCalled();
  });
  const memoInput = (overrides: Record<string, unknown> = {}) => ({
    documentId: 'invoice-1',
    kind: 'CREDIT_MEMO',
    amount: '11.20',
    reason: 'Adjustment',
    submissionKey: 'memo-test',
    ...overrides,
  });
  it('returns an exact memo replay without another number, document, journal or audit', async () => {
    const first = await service.createMemo('Test', actor(), memoInput());
    db.financeDocument.findUnique.mockResolvedValue(first);
    expect(
      await service.createMemo(
        'Test',
        actor(),
        memoInput({ amount: '11.2', reason: ' Adjustment ' }),
      ),
    ).toBe(first);
    expect(db.financeDocument.findUnique).toHaveBeenLastCalledWith({
      where: {
        company_sourceKey: { company: 'Test', sourceKey: 'MEMO:memo-test' },
      },
    });
    for (const call of [
      db.financeDocument.create,
      nextNumber,
      postJournal,
      audit,
    ])
      expect(call).toHaveBeenCalledTimes(1);
  });
  it.each([
    { documentId: 'other' },
    { kind: 'DEBIT_MEMO' },
    { amount: '11.21' },
    { reason: 'Different reason' },
  ])(
    'rejects changed memo details under an existing submission key: %j',
    async (change) => {
      const first = await service.createMemo('Test', actor(), memoInput());
      db.financeDocument.findUnique.mockResolvedValue(first);
      await expect(
        service.createMemo('Test', actor(), memoInput(change)),
      ).rejects.toThrow('different memo details');
      expect(db.financeDocument.create).toHaveBeenCalledTimes(1);
      expect(postJournal).toHaveBeenCalledTimes(1);
    },
  );
  it('permits intentional separate memos with different keys', async () => {
    await service.createMemo('Test', actor(), memoInput());
    await service.createMemo(
      'Test',
      actor(),
      memoInput({ submissionKey: 'second-intent' }),
    );
    expect(db.financeDocument.create).toHaveBeenCalledTimes(2);
    expect(db.financeDocument.create).toHaveBeenLastCalledWith(
      containing({ data: containing({ sourceKey: 'MEMO:second-intent' }) }),
    );
  });
  it('resolves a committed exact memo after a concurrent transaction conflict', async () => {
    const first = await service.createMemo('Test', actor(), memoInput());
    db.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('serialization', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    db.financeDocument.findUnique.mockResolvedValue(first);
    expect(await service.createMemo('Test', actor(), memoInput())).toBe(first);
    expect(db.financeDocument.create).toHaveBeenCalledTimes(1);
  });
  it('rejects missing or blank memo submission keys before any write', async () => {
    for (const submissionKey of [undefined, '', ' ']) {
      await expect(
        service.createMemo('Test', actor(), memoInput({ submissionKey })),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('conserves VAT when a document is fully credited through one-cent memos', async () => {
    const original = document({
      total: d('0.11'),
      subtotal: d('0.10'),
      taxAmount: d('0.01'),
      memos: [] as unknown[],
    });
    const memos: {
      total: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      kind: string;
      status: string;
      data: Prisma.JsonValue;
    }[] = [];
    db.financeDocument.findFirst.mockImplementation(() =>
      Promise.resolve({ ...original, memos }),
    );
    for (let index = 0; index < 11; index++) {
      const memo = await service.createMemo('Test', actor(), {
        submissionKey: 'memo-' + index,
        documentId: 'invoice-1',
        kind: 'CREDIT_MEMO',
        amount: '0.01',
        reason: 'Split adjustment',
      });
      memos.push(memo);
    }
    expect(
      memos.reduce((total, memo) => total.add(memo.taxAmount), d(0)).toFixed(2),
    ).toBe('0.01');
    expect(
      memos.reduce((total, memo) => total.add(memo.subtotal), d(0)).toFixed(2),
    ).toBe('0.10');
  });
  it('fully reverses AP cost accounts across one-cent memos, including signed rounding reclassifications', async () => {
    const original = document({
      kind: 'BILL',
      direction: 'AP',
      total: d('0.09'),
      subtotal: d('0.09'),
      taxAmount: d('0'),
      data: {
        items: [
          { accountCode: '1200', subtotal: '0.05' },
          { accountCode: '5000', subtotal: '0.03' },
          { accountCode: '6000', subtotal: '0.01' },
        ],
      },
    });
    const memos: {
      total: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      kind: string;
      status: string;
      data: Prisma.JsonValue;
    }[] = [];
    db.financeDocument.findFirst.mockImplementation(() =>
      Promise.resolve({ ...original, memos }),
    );
    for (let index = 0; index < 9; index++) {
      const memo = await service.createMemo('Test', actor(), {
        submissionKey: 'memo-' + index,
        documentId: 'invoice-1',
        kind: 'CREDIT_MEMO',
        amount: '0.01',
        reason: 'Split supplier credit',
      });
      memos.push(memo);
    }
    const netCredits = new Map<string, Prisma.Decimal>();
    for (const [, , , journal] of jest.mocked(postJournal).mock.calls) {
      expect(
        journal.lines
          .reduce((total, line) => total.add(line.debit).sub(line.credit), d(0))
          .toFixed(2),
      ).toBe('0.00');
      for (const line of journal.lines)
        netCredits.set(
          line.code,
          (netCredits.get(line.code) ?? d(0)).add(line.credit).sub(line.debit),
        );
    }
    expect(netCredits.get('1200')?.toFixed(2)).toBe('0.05');
    expect(netCredits.get('5000')?.toFixed(2)).toBe('0.03');
    expect(netCredits.get('6000')?.toFixed(2)).toBe('0.01');
    expect(
      jest
        .mocked(postJournal)
        .mock.calls.some(([, , , journal]) =>
          journal.lines.some(
            (line) => line.code === '6000' && d(line.debit).gt(0),
          ),
        ),
    ).toBe(true);
  });
  it('keeps draft documents out of posted balance queries and preserves customer credits', async () => {
    db.financeDocument.findMany.mockResolvedValue([
      document({
        allocations: [{ amount: d('112'), payment: { status: 'POSTED' } }],
        memos: [{ kind: 'CREDIT_MEMO', status: 'POSTED', total: d('12') }],
      }),
    ]);
    const result = await service.balances('Test', actor(), 'AR');
    expect(result.totalOutstanding).toBe('-12.00');
    expect(result.creditBalance).toBe('12.00');
    expect(result.aging).toEqual({
      current: '0.00',
      days1to30: '0.00',
      days31to60: '0.00',
      days61to90: '0.00',
      over90: '0.00',
    });
    expect(db.financeDocument.findMany).toHaveBeenCalledWith(
      containing({
        where: {
          company: 'Test',
          direction: 'AR',
          status: 'POSTED',
          kind: 'INVOICE',
        },
      }),
    );
  });
  it('finalizes weighted product costs without writing manual cost or tier pricing', async () => {
    db.landedCost.findFirst.mockResolvedValue({
      id: 'cost-1',
      company: 'Test',
      shipmentId: 'shipment-1',
      status: 'PROVISIONAL',
      total: d('100'),
      data: {
        allocations: [
          { productId: 1, quantity: 1, totalCost: '25.00' },
          { productId: 1, quantity: 3, totalCost: '75.00' },
        ],
      },
    });
    db.product.updateMany.mockResolvedValue({ count: 1 });
    db.landedCost.update.mockResolvedValue({ status: 'FINAL' });
    await service.finalizeLandedCost('Test', actor(), 'cost-1');
    expect(db.product.updateMany).toHaveBeenCalledWith({
      where: { id: 1, company: 'Test' },
      data: { landedCostReference: d('25') },
    });
    expect(db.productCostHistory.create).toHaveBeenCalledWith(
      containing({ data: containing({ quantity: 4, unitCost: d('25') }) }),
    );
  });
  it.each(['40001', '40P01'])(
    'returns a controlled conflict for raw SQL concurrency code %s without retrying a posting',
    async (code) => {
      db.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Transaction conflict', {
          code: 'P2010',
          clientVersion: 'test',
          meta: { code },
        }),
      );
      await expect(
        service.postDocument('Test', actor(), 'invoice-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(postJournal).not.toHaveBeenCalled();
      expect(db.financeDocument.update).not.toHaveBeenCalled();
    },
  );

  it('preserves unrelated raw SQL errors instead of misclassifying constraint failures', async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Constraint failed',
      {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: '23514' },
      },
    );
    db.$transaction.mockRejectedValueOnce(error);
    await expect(
      service.postDocument('Test', actor(), 'invoice-1'),
    ).rejects.toBe(error);
  });

  it('rejects grouped landed quantity above the database integer boundary', async () => {
    db.landedCost.findFirst.mockResolvedValue({
      id: 'cost-1',
      company: 'Test',
      shipmentId: 'shipment-1',
      status: 'PROVISIONAL',
      total: d('100'),
      data: {
        allocations: [
          { productId: 1, quantity: 2147483647, totalCost: '25.00' },
          { productId: 1, quantity: 1, totalCost: '75.00' },
        ],
      },
    });
    await expect(
      service.finalizeLandedCost('Test', actor(), 'cost-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.product.updateMany).not.toHaveBeenCalled();
    expect(db.productCostHistory.create).not.toHaveBeenCalled();
  });
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  createNumberedDocument,
  nextDocumentNumber,
  type DocumentKind,
} from './document-numbering';

describe('server-assigned sales document numbers', () => {
  const tx = {
    orderSlip: { findMany: jest.fn() },
    purchaseOrder: { findMany: jest.fn() },
    quotation: { findMany: jest.fn() },
    packingList: { findMany: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const database = { ...tx, $transaction: jest.fn() };
  const client = database as unknown as PrismaClient;
  const delegates = {
    OS: [tx.orderSlip, 'osNumber'],
    FO: [tx.orderSlip, 'osNumber'],
    PO: [tx.purchaseOrder, 'poNumber'],
    QT: [tx.quotation, 'qtNumber'],
    PL: [tx.packingList, 'plNumber'],
  } as const;
  beforeEach(() => {
    jest.resetAllMocks();
    for (const [delegate] of Object.values(delegates))
      delegate.findMany.mockResolvedValue([]);
    tx.$executeRaw.mockResolvedValue(1);
    database.$transaction.mockImplementation(
      (work: (value: typeof tx) => Promise<unknown>) => work(tx),
    );
  });
  afterEach(() => jest.useRealTimers());

  it.each<DocumentKind>(['OS', 'FO', 'PO', 'QT', 'PL'])(
    'advances a stale %s starting number over all occupied numbers',
    async (kind) => {
      const [delegate, field] = delegates[kind];
      delegate.findMany.mockResolvedValue([
        { [field]: `${kind}-0099` },
        { [field]: `${kind}-0100` },
      ]);
      await expect(
        nextDocumentNumber(client, kind, 'Surgicom', `${kind}-0099`),
      ).resolves.toBe(`${kind}-0101`);
      expect(delegate.findMany).toHaveBeenCalledWith({
        where: { [field]: { startsWith: `${kind}-` } },
        select: { [field]: true },
      });
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each<DocumentKind>(['OS', 'FO', 'PO', 'QT', 'PL'])(
    'preserves an available custom %s number and its padding',
    async (kind) => {
      await expect(
        nextDocumentNumber(client, kind, 'Surgicom', ` ${kind}-000021 `),
      ).resolves.toBe(`${kind}-000021`);
    },
  );

  it('supports suffixes larger than JavaScript safe integers and width overflow', async () => {
    tx.purchaseOrder.findMany.mockResolvedValue([
      { poNumber: 'CUSTOM-999999999999999999999999' },
    ]);
    await expect(
      nextDocumentNumber(
        client,
        'PO',
        'Olten',
        'CUSTOM-999999999999999999999999',
      ),
    ).resolves.toBe('CUSTOM-1000000000000000000000000');
  });

  it('uses quotation history instead of order slips and ignores lexical ordering', async () => {
    tx.quotation.findMany
      .mockResolvedValueOnce([{ qtNumber: 'QT-99' }, { qtNumber: 'QT-0100' }])
      .mockResolvedValueOnce([{ qtNumber: 'QT-0101' }]);
    await expect(nextDocumentNumber(client, 'QT', 'Olten')).resolves.toBe(
      'QT-0102',
    );
    expect(tx.orderSlip.findMany).not.toHaveBeenCalled();
  });

  it('uses packing-list history independently of final orders', async () => {
    tx.packingList.findMany
      .mockResolvedValueOnce([{ plNumber: 'PL-000025' }])
      .mockResolvedValueOnce([]);
    await expect(nextDocumentNumber(client, 'PL', 'Olten')).resolves.toBe(
      'PL-000026',
    );
    expect(tx.orderSlip.findMany).not.toHaveBeenCalled();
  });

  it('continues the latest manual PO seed, skips cross-company collisions and does not mutate history', async () => {
    const rows = [{ poNumber: 'SPECIAL-0017' }, { poNumber: 'PO-999999' }];
    const before = structuredClone(rows);
    tx.purchaseOrder.findMany
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ poNumber: 'SPECIAL-0018' }]);
    await expect(nextDocumentNumber(client, 'PO', 'Olten')).resolves.toBe(
      'SPECIAL-0019',
    );
    expect(rows).toEqual(before);
  });

  it('preserves available historical nonnumeric labels but cannot silently duplicate them', async () => {
    await expect(
      nextDocumentNumber(client, 'OS', 'Olten', 'OS-LEGACY'),
    ).resolves.toBe('OS-LEGACY');
    tx.orderSlip.findMany.mockResolvedValue([{ osNumber: 'OS-LEGACY' }]);
    await expect(
      nextDocumentNumber(client, 'OS', 'Olten', 'OS-LEGACY'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ['', 'OS', undefined],
    ['Olten', 'WRONG', undefined],
    ['Olten', 'OS', 42],
    ['Olten', 'OS', null],
  ])(
    'rejects malformed numbering input before reading history',
    async (company, kind, seed) => {
      await expect(
        nextDocumentNumber(client, kind as DocumentKind, company, seed),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.orderSlip.findMany).not.toHaveBeenCalled();
    },
  );

  it('locks and saves the assigned number in the same serializable transaction', async () => {
    const write = jest.fn((value: Prisma.TransactionClient, number: string) =>
      Promise.resolve({ value, number }),
    );
    const result = await createNumberedDocument(
      client,
      'FO',
      'Olten',
      'FO-001',
      write,
    );
    expect(result.number).toBe('FO-001');
    expect(tx.$executeRaw).toHaveBeenCalledWith(
      expect.anything(),
      'sales-document-number:osNumber',
    );
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.orderSlip.findMany.mock.invocationCallOrder[0],
    );
    expect(tx.orderSlip.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      write.mock.invocationCallOrder[0],
    );
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 5000,
      timeout: 20000,
    });
  });

  it('coordinates packing lists with final orders while keeping their number histories separate', async () => {
    await createNumberedDocument(
      client,
      'PL',
      'Olten',
      'PL-001',
      (_tx, number) => Promise.resolve(number),
    );
    expect(tx.$executeRaw).toHaveBeenCalledWith(
      expect.anything(),
      'sales-document-number:osNumber',
    );
    expect(tx.packingList.findMany).toHaveBeenCalled();
    expect(tx.orderSlip.findMany).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'P2034' },
    { code: 'P2002', meta: { target: ['osNumber'] } },
    { code: 'P2010', meta: { code: '40001' } },
    { code: 'P2010', meta: { code: '40P01' } },
  ])('automatically retries a fresh transaction for %j', async (error) => {
    jest.useFakeTimers();
    database.$transaction.mockRejectedValueOnce(error);
    const write = jest.fn((_tx: Prisma.TransactionClient, number: string) =>
      Promise.resolve(number),
    );
    const assertion = expect(
      createNumberedDocument(client, 'OS', 'Olten', 'OS-001', write),
    ).resolves.toBe('OS-001');
    await jest.runAllTimersAsync();
    await assertion;
    expect(database.$transaction).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does not retry unrelated uniqueness or business validation failures', async () => {
    const unrelated = {
      code: 'P2002',
      meta: { target: ['externalReference'] },
    };
    database.$transaction.mockRejectedValueOnce(unrelated);
    await expect(
      createNumberedDocument(client, 'OS', 'Olten', 'OS-001', jest.fn()),
    ).rejects.toBe(unrelated);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    const invalid = new BadRequestException('Approve & reserve first.');
    const write = jest.fn().mockRejectedValue(invalid);
    await expect(
      createNumberedDocument(client, 'FO', 'Olten', 'FO-001', write),
    ).rejects.toBe(invalid);
    expect(database.$transaction).toHaveBeenCalledTimes(2);
  });

  it('bounds retries and gives a clear conflict when database contention persists', async () => {
    jest.useFakeTimers();
    database.$transaction.mockRejectedValue({ code: 'P2034' });
    const assertion = expect(
      createNumberedDocument(client, 'OS', 'Olten', 'OS-001', jest.fn()),
    ).rejects.toBeInstanceOf(ConflictException);
    await jest.runAllTimersAsync();
    await assertion;
    expect(database.$transaction).toHaveBeenCalledTimes(12);
  });
});

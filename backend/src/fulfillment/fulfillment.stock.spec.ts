import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  assertLegacyStockFloor,
  assertScan,
  fefo,
  lockProduct,
  lotAvailable,
  materializeLegacy,
  projectIncoming,
  recordReceiptLot,
  type Tx,
} from './fulfillment.stock';

const date = (day: string) => new Date(`${day}T00:00:00.000Z`);
describe('fulfillment quantities and FEFO rules', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-15T17:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  const lot = {
    status: 'AVAILABLE',
    quantity: 10,
    reservedQty: 3,
    expirationDate: date('2026-10-16'),
  };
  it('keeps expiry-day stock usable throughout the Manila date and subtracts reserved quantity', () =>
    expect(lotAvailable(lot)).toBe(7));
  it('excludes the prior Manila calendar day', () =>
    expect(lotAvailable({ ...lot, expirationDate: date('2026-10-15') })).toBe(
      0,
    ));
  it.each(['QUARANTINE', 'DAMAGED', 'REJECTED'])('excludes %s', (status) =>
    expect(lotAvailable({ ...lot, status })).toBe(0),
  );
  it('excludes missing expiry only when expiry control applies', () => {
    expect(lotAvailable({ ...lot, expirationDate: null })).toBe(7);
    expect(
      lotAvailable(
        { ...lot, expirationDate: null },
        { expiryControlled: true, serialControlled: false },
      ),
    ).toBe(0);
  });
  it('excludes missing serial under serial control', () => {
    expect(
      lotAvailable(
        lot,
        { expiryControlled: false, serialControlled: true },
        null,
      ),
    ).toBe(0);
    expect(
      lotAvailable(
        lot,
        { expiryControlled: false, serialControlled: true },
        'S1',
      ),
    ).toBe(7);
  });
  it('sorts FEFO first, then oldest receipt, then stable ID, with undated lots last', () => {
    const receivedAt = date('2026-01-01');
    const lots = [
      { id: 'z', expirationDate: null, receivedAt },
      { id: 'c', expirationDate: date('2027-01-01'), receivedAt },
      { id: 'b', expirationDate: date('2026-12-01'), receivedAt },
      { id: 'a', expirationDate: date('2026-12-01'), receivedAt },
      {
        id: 'early',
        expirationDate: date('2026-12-01'),
        receivedAt: date('2025-01-01'),
      },
    ];
    expect(fefo(lots).map((row) => row.id)).toEqual([
      'early',
      'a',
      'b',
      'c',
      'z',
    ]);
    expect(lots[0].id).toBe('z');
  });
  it.each(['MED1', 'MED1Instrument', 'MED1 Instrument', 'MED1  Instrument'])(
    'accepts existing product sticker format %s',
    (scan) =>
      expect(() =>
        assertScan(scan, { sku: 'MED1', name: 'Instrument' }),
      ).not.toThrow(),
  );
  it.each(['OTHER', '', undefined])('rejects a mismatching scan %s', (scan) =>
    expect(() => assertScan(scan, { sku: 'MED1', name: 'Instrument' })).toThrow(
      BadRequestException,
    ),
  );
});

describe('incoming shipment promise projection', () => {
  const reservation = (quantity = 0, dispatchedQty = 0, releasedQty = 0) => ({
    quantity,
    dispatchedQty,
    releasedQty,
  });
  const allocation = (
    id: string,
    shipmentLineId: string,
    quantity: number,
    day = '2026-01-01',
  ) => ({ id, shipmentLineId, quantity, createdAt: date(day) });
  const order = (
    id: string,
    quantity: number,
    incoming: ReturnType<typeof allocation>[],
    reservations = [reservation()],
    status = 'Open',
  ) => ({ status, items: [{ id, quantity, incoming, reservations }] });
  const shipment = (id: string, shippedQty: number, receivedQty = 0) => ({
    id,
    shippedQty,
    receipts: [{ receivedQty }],
  });
  it('never promises more than remaining incoming quantity across two orders after a partial receipt', () => {
    const result = projectIncoming(
      [
        order('l1', 10, [allocation('a', 's', 8)]),
        order('l2', 10, [allocation('b', 's', 8)]),
      ],
      [shipment('s', 12, 5)],
    );
    expect(result.get('a')).toBe(7);
    expect(result.get('b')).toBe(0);
  });
  it('caps across multiple shipments against remaining unreserved demand', () => {
    const result = projectIncoming(
      [
        order(
          'l1',
          10,
          [allocation('a', 's1', 8), allocation('b', 's2', 8)],
          [reservation(4, 2)],
        ),
      ],
      [shipment('s1', 20), shipment('s2', 20)],
    );
    expect(result.get('a')).toBe(6);
    expect(result.get('b')).toBe(0);
  });
  it('releases future capacity when stock has actually been reserved or order canceled/completed', () => {
    for (const status of ['Cancelled', 'Completed'])
      expect(
        projectIncoming(
          [order('l1', 10, [allocation('a', 's', 8)], [reservation()], status)],
          [shipment('s', 10)],
        ).get('a'),
      ).toBe(0);
    expect(
      projectIncoming(
        [order('l1', 10, [allocation('a', 's', 8)], [reservation(10)])],
        [shipment('s', 10)],
      ).get('a'),
    ).toBe(0);
  });
  it('released reservations restore future demand and excluded allocation allows a replacement', () => {
    const result = projectIncoming(
      [
        order(
          'l1',
          10,
          [allocation('a', 's', 8), allocation('b', 's', 8)],
          [reservation(8, 0, 6)],
        ),
      ],
      [shipment('s', 10)],
      'a',
    );
    expect(result.has('a')).toBe(false);
    expect(result.get('b')).toBe(8);
  });
  it('missing/closed shipment lines contribute no available incoming', () =>
    expect(
      projectIncoming(
        [order('l1', 10, [allocation('a', 'missing', 8)])],
        [],
      ).get('a'),
    ).toBe(0));
});

describe('stock integration safety helpers', () => {
  const database = {
    $queryRaw: jest.fn(),
    product: { findFirst: jest.fn() },
    warehouse: { findFirst: jest.fn(), findMany: jest.fn() },
    warehouseStock: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    warehouseBin: { findFirst: jest.fn() },
    warehouseLot: { aggregate: jest.fn(), create: jest.fn() },
    goodsReceiptLine: { findFirst: jest.fn() },
  };
  const tx = database as unknown as Tx;
  beforeEach(() => {
    jest.resetAllMocks();
    database.$queryRaw.mockResolvedValue([]);
    database.product.findFirst.mockResolvedValue({
      id: 1,
      company: 'Surgicom',
      currentStock: 10,
      expiryControlled: false,
      serialControlled: false,
    });
    database.warehouseStock.findMany.mockResolvedValue([]);
    database.warehouse.findMany.mockResolvedValue([]);
    database.warehouseStock.findUnique.mockResolvedValue(null);
    database.warehouseLot.aggregate.mockResolvedValue({
      _sum: { quantity: 4 },
    });
    database.warehouseLot.create.mockImplementation(
      ({ data }: { data: unknown }) => Promise.resolve(data),
    );
    database.goodsReceiptLine.findFirst.mockResolvedValue({
      id: 'receipt-line',
    });
  });
  it('locks only a same-company product and rejects a missing active record', async () => {
    await lockProduct(tx, 'Surgicom', 1);
    expect(database.product.findFirst).toHaveBeenCalledWith({
      where: { id: 1, company: 'Surgicom', deletedAt: null, isActive: true },
    });
    database.product.findFirst.mockResolvedValue(null);
    await expect(lockProduct(tx, 'Other', 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('allows only legacy decreases that preserve tracked physical quantities', async () => {
    await expect(
      assertLegacyStockFloor(tx, 'Surgicom', 1, 'MASTER', 4),
    ).resolves.toBeUndefined();
    await expect(
      assertLegacyStockFloor(tx, 'Surgicom', 1, 'MASTER', 3),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      assertLegacyStockFloor(tx, 'Surgicom', 1, 'MASTER', -1),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('materializes just the untracked aggregate remainder without updating physical stock', async () => {
    await materializeLegacy(tx, 'Surgicom', 'staff', 1);
    expect(database.warehouseLot.create).toHaveBeenCalledWith({
      data: {
        company: 'Surgicom',
        productId: 1,
        warehouseId: 'MASTER',
        warehouseStockId: null,
        quantity: 6,
        createdBy: 'staff',
      },
    });
  });
  it('never treats unknown legacy quantity as expiry-controlled available stock', async () => {
    database.product.findFirst.mockResolvedValue({
      id: 1,
      currentStock: 10,
      expiryControlled: true,
      serialControlled: false,
    });
    await materializeLegacy(tx, 'Surgicom', 'staff', 1);
    expect(database.warehouseLot.create).not.toHaveBeenCalled();
  });
  it('leaves inactive warehouse balances out of materialization so they cannot block active stock reservations', async () => {
    database.warehouse.findMany.mockResolvedValue([{ id: 2 }]);
    database.warehouseStock.findMany.mockImplementation(
      ({ where }: { where: { warehouseId: { in: string[] } } }) =>
        Promise.resolve(
          [
            { id: 'active', warehouseId: '2', quantity: 6 },
            { id: 'inactive', warehouseId: '3', quantity: 9 },
          ].filter((stock) => where.warehouseId.in.includes(stock.warehouseId)),
        ),
    );
    database.warehouse.findFirst.mockResolvedValue({ id: 2 });
    await materializeLegacy(tx, 'Surgicom', 'staff', 1);
    expect(database.warehouse.findMany).toHaveBeenCalledWith({
      where: { company: 'Surgicom', status: 'Active' },
      select: { id: true },
    });
    expect(database.warehouseStock.findMany).toHaveBeenCalledWith({
      where: { company: 'Surgicom', productId: 1, warehouseId: { in: ['2'] } },
    });
    expect(database.warehouseLot.create).toHaveBeenCalledTimes(2);
    expect(database.warehouseLot.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ warehouseId: '3' }) as unknown,
      }),
    );
  });
  it('rejects already inconsistent physical/lot balances', async () => {
    database.warehouseLot.aggregate.mockResolvedValue({
      _sum: { quantity: 11 },
    });
    await expect(
      materializeLegacy(tx, 'Surgicom', 'staff', 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('adds a receipt child lot once without adding physical aggregates again', async () => {
    await recordReceiptLot(tx, 'Surgicom', 'staff', {
      productId: 1,
      warehouseId: 'MASTER',
      receiptLineId: 'receipt-line',
      quantity: 3,
      batchNumber: 'B1',
      expirationDate: '2027-01-01',
    });
    expect(database.warehouseLot.create).toHaveBeenCalledWith({
      data: {
        company: 'Surgicom',
        createdBy: 'staff',
        productId: 1,
        warehouseId: 'MASTER',
        warehouseStockId: undefined,
        binId: undefined,
        serialNumber: undefined,
        quantity: 3,
        batchNumber: 'B1',
        receiptLineId: 'receipt-line',
        expirationDate: date('2027-01-01'),
      },
    });
    expect(database.goodsReceiptLine.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'receipt-line',
        receipt: { company: 'Surgicom' },
        shipmentLine: { purchaseOrderItem: { productId: 1 } },
      },
    });
  });
  it('rejects lot registration exceeding already updated physical quantity', async () =>
    await expect(
      recordReceiptLot(tx, 'Surgicom', 'staff', {
        productId: 1,
        warehouseId: 'MASTER',
        receiptLineId: 'receipt-line',
        quantity: 7,
      }),
    ).rejects.toBeInstanceOf(ConflictException));
  it('requires an expiry for controlled receipts and one unit per serial', async () => {
    database.product.findFirst.mockResolvedValue({
      id: 1,
      currentStock: 10,
      expiryControlled: true,
      serialControlled: true,
    });
    await expect(
      recordReceiptLot(tx, 'Surgicom', 'staff', {
        productId: 1,
        warehouseId: 'MASTER',
        receiptLineId: 'receipt-line',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      recordReceiptLot(tx, 'Surgicom', 'staff', {
        productId: 1,
        warehouseId: 'MASTER',
        receiptLineId: 'receipt-line',
        quantity: 2,
        expirationDate: '2027-01-01',
        serialNumber: 'S1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('does not create a receipt lot from another workspace', async () => {
    database.goodsReceiptLine.findFirst.mockResolvedValue(null);
    await expect(
      recordReceiptLot(tx, 'Other', 'staff', {
        productId: 1,
        warehouseId: 'MASTER',
        receiptLineId: 'foreign',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.warehouseLot.create).not.toHaveBeenCalled();
  });
});

jest.mock('@prisma/client', () => ({
  ...jest.requireActual<typeof import('@prisma/client')>('@prisma/client'),
  PrismaClient: jest.fn(),
}));

import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProcurementController } from './purchase-orders.controller';

describe('OS-based purchase orders and editable number sequence', () => {
  const database = {
    purchaseOrder: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    supplier: { findUnique: jest.fn() },
    orderSlip: { findFirst: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const input = {
    company: 'Surgicom',
    user: 'operator',
    poNumber: 'CUSTOM-001526',
    osReference: 'OS-000123',
    supplierId: 'supplier1',
    isVatApplied: true,
    items: [
      {
        productId: 1,
        sku: 'MED-1',
        productName: 'Instrument',
        requestedQty: 2,
        unitCost: 12.5,
      },
    ],
  };
  let controller: ProcurementController;
  beforeEach(() => {
    jest.resetAllMocks();
    database.$executeRaw.mockResolvedValue(1);
    controller = new ProcurementController();
    Object.assign(Reflect.get(controller, 'prisma') as object, database);
    database.purchaseOrder.findMany.mockResolvedValue([]);
    database.purchaseOrder.findUnique.mockResolvedValue(null);
    database.purchaseOrder.create.mockImplementation(
      ({ data }: { data: object }) => Promise.resolve(data),
    );
    database.supplier.findUnique.mockResolvedValue({ id: 'supplier1' });
    database.orderSlip.findFirst.mockResolvedValue({ status: 'Generated' });
    database.$transaction.mockImplementation(
      (work: (tx: object) => Promise<unknown>) => work(database),
    );
  });

  it.each([
    ['PO-15226', 'PO-15227'],
    ['15226', '15227'],
    ['CUSTOM-000099', 'CUSTOM-000100'],
    ['PO-999', 'PO-1000'],
    ['PO-000000', 'PO-000001'],
    ['PO-9007199254740992', 'PO-9007199254740993'],
  ])('continues the last saved custom number %s as %s', async (saved, next) => {
    database.purchaseOrder.findMany.mockResolvedValueOnce([
      { poNumber: saved },
    ]);
    await expect(controller.getNextPoNumber('Surgicom')).resolves.toEqual({
      poNumber: next,
    });
    expect(database.purchaseOrder.findMany).toHaveBeenNthCalledWith(1, {
      where: { company: 'Surgicom' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { poNumber: true },
    });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('uses the latest manual seed rather than an older larger number and skips global collisions', async () => {
    database.purchaseOrder.findMany
      .mockResolvedValueOnce([{ poNumber: 'PO-0017' }, { poNumber: 'PO-9999' }])
      .mockResolvedValueOnce([
        { poNumber: 'PO-0018' },
        { poNumber: 'PO-0019' },
      ]);
    await expect(controller.getNextPoNumber('Surgicom')).resolves.toEqual({
      poNumber: 'PO-0020',
    });
    expect(database.purchaseOrder.findMany).toHaveBeenNthCalledWith(2, {
      where: { poNumber: { startsWith: 'PO-' } },
      select: { poNumber: true },
    });
  });

  it('continues the last usable historical number when the newest legacy label has no numeric suffix', async () => {
    database.purchaseOrder.findMany.mockResolvedValueOnce([
      { poNumber: 'LEGACY' },
      { poNumber: 'SC-0041' },
    ]);
    await expect(controller.getNextPoNumber('Surgicom')).resolves.toEqual({
      poNumber: 'SC-0042',
    });
  });

  it('starts an unused default sequence when this company has no usable seed', async () => {
    database.purchaseOrder.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ poNumber: 'PO-000001' }]);
    await expect(controller.getNextPoNumber('Surgicom')).resolves.toEqual({
      poNumber: 'PO-000002',
    });
  });

  it('requires company before reading number history', async () => {
    await expect(controller.getNextPoNumber(' ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(database.purchaseOrder.findMany).not.toHaveBeenCalled();
  });

  it('saves an editable number with its valid same-company source OS and preserves VAT and rounding', async () => {
    await expect(
      controller.createPurchaseOrder({
        ...input,
        poNumber: ' CUSTOM-001526 ',
        osReference: ' OS-000123 ',
      }),
    ).resolves.toMatchObject({
      poNumber: 'CUSTOM-001526',
      osReference: 'OS-000123',
      subtotal: 25,
      vatAmount: 3,
      grandTotal: 28,
    });
    expect(database.orderSlip.findFirst).toHaveBeenCalledWith({
      where: { company: 'Surgicom', osNumber: 'OS-000123' },
      select: { status: true },
    });
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 20000,
    });
  });

  it.each(['', 'FO-00123', null, undefined])(
    'rejects missing or non-OS source %s before writing',
    async (osReference) => {
      await expect(
        controller.createPurchaseOrder({ ...input, osReference }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.purchaseOrder.create).not.toHaveBeenCalled();
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each([null, { status: 'Cancelled' }, { status: 'Returned' }])(
    'rejects a missing, foreign or inactive source OS',
    async (source) => {
      database.orderSlip.findFirst.mockResolvedValue(source);
      await expect(
        controller.createPurchaseOrder(input),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.orderSlip.findFirst).toHaveBeenCalledWith({
        where: { company: 'Surgicom', osNumber: input.osReference },
        select: { status: true },
      });
      expect(database.purchaseOrder.create).not.toHaveBeenCalled();
    },
  );

  it.each(['MANUAL', null, 123])(
    'rejects a number that cannot be continued safely',
    async (poNumber) => {
      await expect(
        controller.createPurchaseOrder({ ...input, poNumber }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.purchaseOrder.create).not.toHaveBeenCalled();
    },
  );

  it('advances a taken numeric starting number without changing an existing PO', async () => {
    database.purchaseOrder.findMany.mockResolvedValue([
      { poNumber: input.poNumber },
    ]);
    await expect(controller.createPurchaseOrder(input)).resolves.toMatchObject({
      poNumber: 'CUSTOM-001527',
    });
    expect(database.purchaseOrder.findUnique).not.toHaveBeenCalled();
  });

  it('retries a concurrent number collision in a fresh transaction', async () => {
    database.purchaseOrder.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6',
        meta: { target: ['poNumber'] },
      }),
    );
    await expect(controller.createPurchaseOrder(input)).resolves.toMatchObject({
      poNumber: input.poNumber,
    });
    expect(database.$transaction).toHaveBeenCalledTimes(2);
  });
});

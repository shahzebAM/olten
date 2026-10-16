jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  return { ...actual, PrismaClient: jest.fn() };
});
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FulfillmentService, samePodReceipt } from './fulfillment.service';

describe('fulfillment workflow state and conflict protection', () => {
  const database = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $disconnect: jest.fn(),
    product: { findFirst: jest.fn() },
    cycleCount: { findFirst: jest.fn(), update: jest.fn() },
    warehouseLot: { findFirst: jest.fn(), updateMany: jest.fn() },
    delivery: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    deliverySource: { findUnique: jest.fn(), update: jest.fn() },
    deliveryItem: { update: jest.fn() },
    deliveryPod: { create: jest.fn() },
    customerOrderLine: { update: jest.fn() },
    customerOrder: { findFirst: jest.fn(), update: jest.fn() },
    inventoryMovement: { create: jest.fn() },
  };
  let service: FulfillmentService;
  const admin = { id: 1, username: 'admin', role: 'Admin', modules: {} };
  beforeEach(() => {
    jest.resetAllMocks();
    service = new FulfillmentService();
    Object.assign(Reflect.get(service, 'prisma') as object, database);
    database.$transaction.mockImplementation(
      (work: (tx: object) => Promise<unknown>) => work(database),
    );
    database.$queryRaw.mockResolvedValue([]);
    database.product.findFirst.mockResolvedValue({
      id: 1,
      sku: 'MED1',
      name: 'Instrument',
    });
  });
  it('uses SERIALIZABLE transactions for all physical workflows', async () => {
    await expect(
      service.transaction(() => Promise.resolve('ok')),
    ).resolves.toBe('ok');
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20000,
    });
  });
  it('requires customer orders to originate from OS approval without writing standalone orders', () => {
    expect(() => service.createOrder()).toThrow(
      'Create an Order Slip first, then use Approve & reserve.',
    );
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it.each(['P2034', 'P2002'])(
    'returns a conflict for concurrent write or duplicate serial %s',
    async (code) => {
      database.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('conflict', {
          code,
          clientVersion: '6',
        }),
      );
      await expect(
        service.transaction(() => Promise.resolve()),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );
  it('does not hide other database errors', async () => {
    const failure = new Error('connection failed');
    database.$transaction.mockRejectedValue(failure);
    await expect(service.transaction(() => Promise.resolve())).rejects.toBe(
      failure,
    );
  });
  it('restricts approval and accepts the explicit warehouse approver permission', () => {
    expect(() => service.canApprove({ ...admin, role: 'Staff' })).toThrow(
      ForbiddenException,
    );
    expect(() =>
      service.canApprove({
        ...admin,
        role: 'Staff',
        modules: { warehouse_approve: true },
      }),
    ).not.toThrow();
    expect(() => service.canApprove(admin)).not.toThrow();
  });
  it('rejects malformed quantities before changing the database', async () => {
    await expect(
      service.registerLot('Surgicom', 'staff', {
        productId: 1,
        warehouseId: 'MASTER',
        quantity: 1.5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createCount('Surgicom', 'staff', { lotIds: ['same', 'same'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it('does not repeat dispatch stock mutations when an issued DEL is retried', async () => {
    const delivery = {
      id: 'd',
      dispatchedAt: new Date(),
      status: 'Dispatched',
    };
    database.delivery.findFirst.mockResolvedValue(delivery);
    await expect(service.dispatch('Surgicom', 'staff', 'd')).resolves.toEqual(
      delivery,
    );
    expect(database.warehouseLot.updateMany).not.toHaveBeenCalled();
    expect(database.inventoryMovement.create).not.toHaveBeenCalled();
  });
  it.each(['PartiallyDelivered', 'Delivered'])(
    'does not apply an identical POD retry again when the delivery is %s',
    async (status) => {
      const receivedAt = new Date(Date.now() - 1000);
      const items = [{ deliveryItemId: 'item', quantity: 2 }];
      const delivery = {
        id: 'd',
        status,
        pods: [{ recipient: 'Receiver', receivedAt, items, documentId: 1 }],
      };
      database.delivery.findFirst.mockResolvedValue(delivery);
      await expect(
        service.pod('Surgicom', 'staff', 'd', {
          recipient: ' Receiver ',
          receivedAt: receivedAt.toISOString(),
          receiptUrl: 'https://example.test/new-upload.pdf',
          items,
        }),
      ).resolves.toBe(delivery);
      expect(database.deliveryItem.update).not.toHaveBeenCalled();
      expect(database.customerOrderLine.update).not.toHaveBeenCalled();
      expect(database.deliveryPod.create).not.toHaveBeenCalled();
    },
  );
  it('matches a retried receipt regardless of line ordering', () => {
    const receivedAt = new Date();
    const items = [
      { deliveryItemId: 'first', quantity: 2 },
      { deliveryItemId: 'second', quantity: 3 },
    ];
    expect(
      samePodReceipt(
        { recipient: 'Receiver', receivedAt, items },
        { recipient: 'Receiver', receivedAt, items: [...items].reverse() },
      ),
    ).toBe(true);
  });
  it('records a later partial receipt with the same quantities as a separate receipt', async () => {
    const receivedAt = new Date(Date.now() - 1000);
    const items = [{ deliveryItemId: 'item', quantity: 2 }];
    const delivery = {
      id: 'd',
      status: 'PartiallyDelivered',
      dispatchedAt: new Date(Date.now() - 10000),
      orderId: 'order',
      items: [
        {
          id: 'item',
          productId: 1,
          orderLineId: 'line',
          quantity: 10,
          deliveredQty: 2,
        },
      ],
      pods: [
        {
          recipient: 'Receiver',
          receivedAt: new Date(receivedAt.getTime() - 1000),
          items,
        },
      ],
    };
    database.delivery.findFirst.mockResolvedValue(delivery);
    database.customerOrder.findFirst.mockResolvedValue({
      items: [{ quantity: 10, deliveredQty: 4 }],
    });
    await service.pod('Surgicom', 'staff', 'd', {
      recipient: 'Receiver',
      receivedAt: receivedAt.toISOString(),
      receiptUrl: 'https://example.test/later-receipt.pdf',
      items,
    });
    expect(database.deliveryItem.update).toHaveBeenCalledWith({
      where: { id: 'item' },
      data: { deliveredQty: { increment: 2 } },
    });
    expect(database.customerOrderLine.update).toHaveBeenCalledTimes(1);
    expect(database.deliveryPod.create).toHaveBeenCalledTimes(1);
  });
  it('does not approve a stale cycle-count snapshot', async () => {
    const lot = {
      id: 'lot',
      company: 'Surgicom',
      productId: 1,
      quantity: 10,
      reservedQty: 2,
      version: 3,
    };
    database.cycleCount.findFirst.mockResolvedValue({
      id: 'c',
      status: 'Submitted',
      lines: [
        {
          id: 'cl',
          lotId: 'lot',
          lot,
          expectedQty: 10,
          expectedReservedQty: 2,
          expectedVersion: 2,
          countedQty: 9,
        },
      ],
    });
    database.warehouseLot.findFirst.mockResolvedValue(lot);
    await expect(
      service.approveCount('Surgicom', admin, 'c'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.warehouseLot.updateMany).not.toHaveBeenCalled();
    expect(database.inventoryMovement.create).not.toHaveBeenCalled();
  });
  it('returns the same approved count without writing a second adjustment', async () => {
    const count = { id: 'c', status: 'Approved', lines: [] };
    database.cycleCount.findFirst.mockResolvedValue(count);
    await expect(service.approveCount('Surgicom', admin, 'c')).resolves.toEqual(
      count,
    );
    expect(database.cycleCount.update).not.toHaveBeenCalled();
  });
  it('keeps a cancelled delivery source as a permanent managed marker', async () => {
    database.deliverySource.findUnique.mockResolvedValue({
      id: 'source',
      cancelledAt: new Date(),
    });
    await expect(
      service.cancelDocument(
        database as unknown as Prisma.TransactionClient,
        'Surgicom',
        'staff',
        'FO',
        'fo',
      ),
    ).resolves.toBe(true);
    expect(database.deliverySource.update).not.toHaveBeenCalled();
  });
  it('forbids cancellation of dispatched documents', async () => {
    database.deliverySource.findUnique.mockResolvedValue({
      id: 'source',
      deliveryId: 'd',
      cancelledAt: null,
    });
    database.delivery.findFirst.mockResolvedValue({
      id: 'd',
      dispatchedAt: new Date(),
      status: 'Dispatched',
    });
    await expect(
      service.cancelDocument(
        database as unknown as Prisma.TransactionClient,
        'Surgicom',
        'staff',
        'FO',
        'fo',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.deliverySource.update).not.toHaveBeenCalled();
  });
});

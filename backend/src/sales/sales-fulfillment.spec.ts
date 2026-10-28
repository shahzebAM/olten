jest.mock('@prisma/client', () => ({
  ...jest.requireActual<typeof import('@prisma/client')>('@prisma/client'),
  PrismaClient: jest.fn(),
}));

jest.mock('../fulfillment/fulfillment.stock', () => ({
  lockProduct: jest.fn().mockResolvedValue({ currentStock: 20 }),
  assertLegacyStockFloor: jest.fn().mockResolvedValue(undefined),
}));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import {
  FulfillmentAuthGuard,
  type FulfillmentRequest,
} from '../fulfillment/fulfillment-auth.guard';
import { assertLegacyStockFloor } from '../fulfillment/fulfillment.stock';
import { OrderSlipsController } from './order-slips.controller';
import { PackingListsController } from './packing-lists.controller';

function guards(prototype: object, method: string): unknown {
  const handler: unknown = Reflect.get(prototype, method);
  return Reflect.getMetadata(GUARDS_METADATA, handler as object) as unknown;
}

describe('sales Phase 2 fulfillment integration', () => {
  let controller: OrderSlipsController;
  let packing: PackingListsController;
  const request = {
    headers: { 'x-company': 'Surgicom' },
    user: { username: 'verified-operator' },
  } as unknown as FulfillmentRequest;
  const product = {
    id: 7,
    company: 'Surgicom',
    sku: 'MED-7',
    name: 'Medical item',
    sellingPrice: 12.5,
    currentStock: 20,
  };
  const item = {
    id: 'item-1',
    productId: 7,
    sku: 'MED-7',
    productName: 'Medical item',
    requestedQty: 2,
    unitPrice: 12.5,
    lineTotal: 25,
  };
  const order = {
    id: 'os-1',
    osNumber: 'OS-000001',
    referenceOs: null,
    company: 'Surgicom',
    customerId: 'SU-01',
    status: 'Generated',
    vatApplied: true,
    subtotal: 25,
    vatAmount: 3,
    grandTotal: 28,
    items: [{ ...item, product: { currentStock: 20 } }],
  };
  const payload = {
    company: 'Other company',
    user: 'forged-actor',
    osNumber: 'OS-000001',
    customerId: 'SU-01',
    isVatApplied: true,
    vatRate: 0.12,
    items: [{ ...item }],
  };
  const db = {
    customer: { findFirst: jest.fn() },
    product: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    orderSlip: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    orderSlipItem: { deleteMany: jest.fn(), update: jest.fn() },
    packingList: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    shortage: { create: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const fulfillment = {
    ensureDocumentDelivery: jest.fn(),
    availableStock: jest.fn(),
    assertDocumentMutable: jest.fn(),
    cancelDocument: jest.fn(),
    assertOrderSlipMutable: jest.fn(),
    cancelOrderSlip: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    db.$executeRaw.mockResolvedValue(1);
    db.orderSlip.findMany.mockResolvedValue([]);
    db.packingList.findMany.mockResolvedValue([]);
    db.customer.findFirst.mockResolvedValue({
      id: 'SU-01',
      company: 'Surgicom',
    });
    db.product.findMany.mockResolvedValue([product]);
    db.product.findFirst.mockResolvedValue(product);
    db.orderSlip.findFirst.mockResolvedValue(null);
    db.orderSlip.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...order, ...data, items: order.items }),
    );
    db.orderSlip.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...order, ...data, items: order.items }),
    );
    db.orderSlip.delete.mockResolvedValue(order);
    db.packingList.create.mockResolvedValue({
      id: 'pl-1',
      plNumber: 'PL-000001',
      items: [item],
    });
    db.packingList.findFirst.mockResolvedValue({
      ...order,
      id: 'pl-1',
      plNumber: 'PL-000001',
    });
    db.packingList.update.mockResolvedValue({
      id: 'pl-1',
      status: 'Cancelled',
    });
    db.packingList.delete.mockResolvedValue({ id: 'pl-1' });
    db.$transaction.mockImplementation(
      (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
    );
    fulfillment.ensureDocumentDelivery.mockResolvedValue({ id: 'del-1' });
    fulfillment.assertDocumentMutable.mockResolvedValue(false);
    fulfillment.cancelDocument.mockResolvedValue(false);
    fulfillment.assertOrderSlipMutable.mockResolvedValue(false);
    fulfillment.cancelOrderSlip.mockResolvedValue(false);
    controller = new OrderSlipsController(
      fulfillment as unknown as FulfillmentService,
    );
    packing = new PackingListsController(
      fulfillment as unknown as FulfillmentService,
    );
    Object.assign(Reflect.get(controller, 'prisma') as object, db);
    Object.assign(Reflect.get(packing, 'prisma') as object, db);
  });

  it('saves a generated OS without reserving stock and preserves 12% VAT calculations', async () => {
    await expect(
      controller.createOrderSlip(payload, request),
    ).resolves.toMatchObject({
      status: 'Generated',
      subtotal: 25,
      vatAmount: 3,
      grandTotal: 28,
      company: 'Surgicom',
      createdBy: 'verified-operator',
    });
    expect(db.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 'SU-01', company: 'Surgicom' },
    });
    expect(fulfillment.ensureDocumentDelivery).not.toHaveBeenCalled();
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it('queues a Final Order within the transaction without decrementing physical stock', async () => {
    await controller.createOrderSlip(
      { ...payload, osNumber: 'FO-000001', referenceOs: 'OS-000001' },
      request,
    );
    expect(fulfillment.ensureDocumentDelivery).toHaveBeenCalledWith(
      db,
      'Surgicom',
      'verified-operator',
      {
        sourceType: 'FO',
        sourceId: 'os-1',
        documentNumber: 'FO-000001',
        referenceOs: 'OS-000001',
        customerId: 'SU-01',
        items: [{ productId: 7, quantity: 2 }],
      },
    );
    expect(db.product.update).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('requires source approval and reservation before completing a Final Order', async () => {
    fulfillment.ensureDocumentDelivery.mockRejectedValueOnce(
      new ConflictException('Approve & reserve first.'),
    );
    await expect(
      controller.createOrderSlip(
        { ...payload, osNumber: 'FO-000001' },
        request,
      ),
    ).rejects.toThrow('Approve & reserve first.');
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it('preserves monetary rounding on generated documents', async () => {
    await expect(
      controller.createOrderSlip(
        { ...payload, items: [{ ...item, requestedQty: 3, unitPrice: 0.335 }] },
        request,
      ),
    ).resolves.toMatchObject({
      subtotal: 1.01,
      vatAmount: 0.12,
      grandTotal: 1.13,
    });
  });

  it.each([
    [1, 1.005, 1.01, 0.12, 1.13],
    [3, 2.675, 8.03, 0.96, 8.99],
    [1, 0.375, 0.38, 0.05, 0.43],
    [2, 0.335, 0.67, 0.08, 0.75],
  ])(
    'rounds approved decimal price boundaries for %s × %s',
    async (quantity, price, subtotal, vatAmount, grandTotal) => {
      const saved = await controller.createOrderSlip(
        {
          ...payload,
          items: [{ ...item, requestedQty: quantity, unitPrice: price }],
        },
        request,
      );
      expect(saved).toMatchObject({ subtotal, vatAmount, grandTotal });
      expect(db.product.update).not.toHaveBeenCalled();
      expect(fulfillment.ensureDocumentDelivery).not.toHaveBeenCalled();
    },
  );

  it('rounds VAT half cents after summing rounded lines', async () => {
    await expect(
      controller.createOrderSlip(
        {
          ...payload,
          vatRate: 0.1,
          items: [{ ...item, requestedQty: 1, unitPrice: 0.25 }],
        },
        request,
      ),
    ).resolves.toMatchObject({
      subtotal: 0.25,
      vatAmount: 0.03,
      grandTotal: 0.28,
    });
  });

  it.each([0, -1, 1.5, Infinity])(
    'rejects invalid new document quantity %s',
    async (requestedQty) => {
      await expect(
        controller.createOrderSlip(
          { ...payload, items: [{ ...item, requestedQty }] },
          request,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.orderSlip.create).not.toHaveBeenCalled();
    },
  );

  it('rejects customers outside the verified company', async () => {
    db.customer.findFirst.mockResolvedValueOnce(null);
    await expect(
      controller.createOrderSlip(payload, request),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.orderSlip.create).not.toHaveBeenCalled();
  });

  it('queues a Packing List using its real endpoint without a second physical debit', async () => {
    await packing.createPackingList(
      {
        ...payload,
        plNumber: 'PL-000001',
        referenceOs: 'OS-000001',
        subtotal: 25,
        vatAmount: 3,
        grandTotal: 28,
      },
      request,
    );
    expect(fulfillment.ensureDocumentDelivery).toHaveBeenCalledWith(
      db,
      'Surgicom',
      'verified-operator',
      expect.objectContaining({
        sourceType: 'PL',
        sourceId: 'pl-1',
        items: [{ productId: 7, quantity: 2 }],
      }),
    );
    expect(db.packingList.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 25,
          vatAmount: 3,
          grandTotal: 28,
          company: 'Surgicom',
          createdBy: 'verified-operator',
        }) as unknown,
      }),
    );
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it('rejects a Packing List containing another company product', async () => {
    db.product.findMany.mockResolvedValueOnce([]);
    await expect(
      packing.createPackingList(
        {
          ...payload,
          plNumber: 'PL-000001',
          subtotal: 25,
          vatAmount: 3,
          grandTotal: 28,
        },
        request,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.packingList.create).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'delete'])(
    'supports linked PL %s without restoring undispatched stock',
    async (operation) => {
      fulfillment.cancelDocument.mockResolvedValue(true);
      if (operation === 'cancel')
        await packing.cancelPackingList('pl-1', request);
      else await packing.deletePackingList('pl-1', request);
      expect(fulfillment.cancelDocument).toHaveBeenCalledWith(
        db,
        'Surgicom',
        'verified-operator',
        'PL',
        'pl-1',
      );
      expect(db.product.update).not.toHaveBeenCalled();
    },
  );

  it('restores a legacy PL once and blocks dispatched PL deletion', async () => {
    await packing.cancelPackingList('pl-1', request);
    expect(db.product.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { currentStock: { increment: 2 } },
    });
    db.product.update.mockClear();
    fulfillment.cancelDocument.mockRejectedValueOnce(
      new ConflictException('Already dispatched.'),
    );
    await expect(packing.deletePackingList('pl-1', request)).rejects.toThrow(
      'Already dispatched.',
    );
    expect(db.product.update).not.toHaveBeenCalled();
    expect(db.packingList.delete).not.toHaveBeenCalled();
  });

  it('uses canonical available stock for search and refresh, scoped by the verified header', async () => {
    const available = {
      officeStock: 3,
      warehouseQty: 4,
      warehouseBreakdown: [{ name: 'WH1', quantity: 4 }],
      availableQty: 7,
      reservedQty: 13,
    };
    fulfillment.availableStock.mockResolvedValue({ 7: available });
    await expect(controller.searchProducts('Surgicom', 'MED')).resolves.toEqual(
      [expect.objectContaining({ id: 7, ...available })],
    );
    await expect(
      controller.refreshStock(
        { company: 'Other company', productIds: [7] },
        request,
      ),
    ).resolves.toEqual({ 7: available });
    expect(fulfillment.availableStock).toHaveBeenLastCalledWith(
      expect.any(Object),
      'Surgicom',
      [7],
    );
  });

  it('cancels linked FO allocations without restoring stock that was never dispatched', async () => {
    db.orderSlip.findFirst.mockResolvedValue({
      ...order,
      osNumber: 'FO-000001',
    });
    fulfillment.cancelDocument.mockResolvedValue(true);
    await controller.cancelOrderSlip('os-1', request);
    expect(fulfillment.cancelDocument).toHaveBeenCalledWith(
      db,
      'Surgicom',
      'verified-operator',
      'FO',
      'os-1',
    );
    expect(db.product.update).not.toHaveBeenCalled();
    expect(db.orderSlip.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'Cancelled', updatedBy: 'verified-operator' },
      }),
    );
  });

  it('keeps historical FO restoration when no Phase 2 marker exists', async () => {
    db.orderSlip.findFirst.mockResolvedValue({
      ...order,
      osNumber: 'FO-000001',
    });
    await controller.cancelOrderSlip('os-1', request);
    expect(db.product.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { currentStock: { increment: 2 } },
    });
  });

  it('never restores a returned historic FO a second time', async () => {
    db.orderSlip.findFirst.mockResolvedValue({
      ...order,
      osNumber: 'FO-000001',
      status: 'Returned',
    });
    await controller.cancelOrderSlip('os-1', request);
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it('also skips phantom restoration through PATCH and permanent deletion', async () => {
    db.orderSlip.findFirst.mockResolvedValue({
      ...order,
      osNumber: 'FO-000001',
    });
    fulfillment.cancelDocument.mockResolvedValue(true);
    await controller.updateOrderSlip('os-1', { status: 'Cancelled' }, request);
    await controller.hardDeleteOrderSlip('os-1', request);
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it('blocks physical document cancellation when the delivery is already dispatched', async () => {
    db.orderSlip.findFirst.mockResolvedValue({
      ...order,
      osNumber: 'FO-000001',
    });
    fulfillment.cancelDocument.mockRejectedValueOnce(
      new ConflictException('Delivery already dispatched.'),
    );
    await expect(
      controller.hardDeleteOrderSlip('os-1', request),
    ).rejects.toThrow('Delivery already dispatched.');
    expect(db.orderSlip.delete).not.toHaveBeenCalled();
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it('blocks item replacement on delivery managed documents before any stock or item mutation', async () => {
    db.orderSlip.findFirst.mockResolvedValue({
      ...order,
      osNumber: 'FO-000001',
    });
    fulfillment.assertDocumentMutable.mockResolvedValue(true);
    await expect(
      controller.updateOrderSlip('os-1', { items: [item] }, request),
    ).rejects.toThrow('Cancel the undispatched document');
    expect(db.orderSlipItem.deleteMany).not.toHaveBeenCalled();
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it('requires releasing an approved OS before changing reserved quantities', async () => {
    db.orderSlip.findFirst.mockResolvedValue({ ...order, status: 'Approved' });
    fulfillment.assertOrderSlipMutable.mockRejectedValueOnce(
      new ConflictException('Cancel and release this order before editing.'),
    );
    await expect(
      controller.updateOrderSlip(
        'os-1',
        { status: 'Approved', items: [item] },
        request,
      ),
    ).rejects.toThrow('Cancel and release');
    expect(db.orderSlipItem.deleteMany).not.toHaveBeenCalled();
  });

  it('checks the tracked stock floor before editing an historical FO', async () => {
    db.orderSlip.findFirst.mockResolvedValue({
      ...order,
      osNumber: 'FO-000001',
    });
    await controller.updateOrderSlip('os-1', { items: [item] }, request);
    expect(assertLegacyStockFloor).toHaveBeenCalledWith(
      db,
      'Surgicom',
      7,
      'MASTER',
      18,
    );
  });

  it('does not allow a status PATCH to bypass approval and reservation', async () => {
    db.orderSlip.findFirst.mockResolvedValue(order);
    await expect(
      controller.updateOrderSlip('os-1', { status: 'Approved' }, request),
    ).rejects.toThrow('Use Approve & reserve');
    expect(db.orderSlip.update).not.toHaveBeenCalled();
  });

  it('automatically retries a concurrent creation transaction without duplicating the order', async () => {
    db.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await expect(
      controller.createOrderSlip(payload, request),
    ).resolves.toMatchObject({ osNumber: 'OS-000001' });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.orderSlip.create).toHaveBeenCalledTimes(1);
  });

  it('protects stock-affecting mutations without changing the legacy QR sync route', () => {
    for (const method of [
      'createOrderSlip',
      'updateOrderSlip',
      'cancelOrderSlip',
      'hardDeleteOrderSlip',
      'processOrderSlip',
      'refreshStock',
    ] as const) {
      expect(guards(OrderSlipsController.prototype, method)).toContain(
        FulfillmentAuthGuard,
      );
    }
    expect(
      guards(PackingListsController.prototype, 'createPackingList'),
    ).toContain(FulfillmentAuthGuard);
    expect(
      guards(PackingListsController.prototype, 'cancelPackingList'),
    ).toContain(FulfillmentAuthGuard);
    expect(
      guards(PackingListsController.prototype, 'deletePackingList'),
    ).toContain(FulfillmentAuthGuard);
    expect(
      guards(OrderSlipsController.prototype, 'saveProductQRs'),
    ).toBeUndefined();
  });
});

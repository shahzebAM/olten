jest.mock('@prisma/client', () => ({
  ...jest.requireActual<typeof import('@prisma/client')>('@prisma/client'),
  PrismaClient: jest.fn(),
}));

import { BadRequestException } from '@nestjs/common';
import { ProcurementController } from './purchase-orders.controller';

describe('purchase order importation receiving boundary', () => {
  let controller: ProcurementController;
  const order = {
    id: 'po-1',
    poNumber: 'PO-2026-000001',
    company: 'Surgicom',
    status: 'Generated',
    items: [
      {
        id: 'item-1',
        requestedQty: 10,
        sku: 'MED-1',
        productName: 'Medical item',
      },
    ],
  };
  const database = {
    purchaseOrder: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    purchaseOrderItem: { update: jest.fn() },
    shortage: { create: jest.fn(), updateMany: jest.fn() },
    shipmentLine: { count: jest.fn() },
    $transaction: jest.fn(),
  };
  beforeEach(() => {
    jest.resetAllMocks();
    database.purchaseOrder.findUnique.mockResolvedValue(order);
    database.purchaseOrder.findFirst.mockResolvedValue(null);
    database.purchaseOrder.update.mockImplementation(
      ({ data }: { data: object }) => Promise.resolve({ ...order, ...data }),
    );
    database.shipmentLine.count.mockResolvedValue(0);
    database.$transaction.mockImplementation(
      async (callback: (client: typeof database) => Promise<unknown>) =>
        callback(database),
    );
    controller = new ProcurementController();
    Object.assign(Reflect.get(controller, 'prisma') as object, database);
  });

  it('preserves the legacy receiving path for ordinary purchase orders', async () => {
    await expect(
      controller.receivePurchaseOrder('po-1', {
        user: 'receiver',
        verifications: [{ itemId: 'item-1', confirmedQty: 10 }],
      }),
    ).resolves.toMatchObject({ status: 'Received', updatedBy: 'receiver' });
    expect(database.purchaseOrderItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { confirmedQty: 10, shortageQty: 0 },
    });
    expect(database.shortage.create).not.toHaveBeenCalled();
  });

  it('keeps legacy shortages when ordinary PO deliveries are partial', async () => {
    await expect(
      controller.receivePurchaseOrder('po-1', {
        user: 'receiver',
        verifications: [{ itemId: 'item-1', confirmedQty: 7 }],
      }),
    ).resolves.toMatchObject({ status: 'Partially Received' });
    expect(database.shortage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedQty: 10,
        confirmedQty: 7,
        shortageQty: 3,
      }) as unknown,
    });
  });

  it.each(['receive', 'status', 'delete'])(
    'blocks legacy %s for requisition or shipment managed POs',
    async (operation) => {
      database.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1' });
      const call =
        operation === 'receive'
          ? controller.receivePurchaseOrder('po-1', {
              user: 'receiver',
              verifications: [{ itemId: 'item-1', confirmedQty: 10 }],
            })
          : operation === 'status'
            ? controller.updatePurchaseOrderStatus('po-1', {
                status: 'Stocked',
                user: 'receiver',
              })
            : controller.hardDeletePurchaseOrder('po-1');
      await expect(call).rejects.toBeInstanceOf(BadRequestException);
      expect(database.purchaseOrder.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'po-1',
          OR: [
            { requisition: { isNot: null } },
            { items: { some: { shipmentLines: { some: {} } } } },
          ],
        },
        select: { id: true },
      });
      expect(database.purchaseOrderItem.update).not.toHaveBeenCalled();
      expect(database.purchaseOrder.update).not.toHaveBeenCalled();
      expect(database.purchaseOrder.delete).not.toHaveBeenCalled();
    },
  );

  it('blocks cancelling shipment-linked POs before changing shortages or PO state', async () => {
    database.shipmentLine.count.mockResolvedValue(1);
    await expect(
      controller.cancelPurchaseOrder('po-1', 'receiver'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.shortage.updateMany).not.toHaveBeenCalled();
    expect(database.purchaseOrder.update).not.toHaveBeenCalled();
  });

  it('marks both requisition and shipment linked orders so legacy UI cannot receive them', async () => {
    database.purchaseOrder.findMany.mockResolvedValue([
      {
        ...order,
        supplier: null,
        requisition: { id: 'pr-1' },
        _count: { items: 0 },
      },
      {
        ...order,
        id: 'po-2',
        supplier: { legalName: 'Supplier' },
        requisition: null,
        _count: { items: 1 },
      },
      {
        ...order,
        id: 'po-3',
        supplier: null,
        requisition: null,
        _count: { items: 0 },
      },
    ]);
    const rows = await controller.listPurchaseOrders('Surgicom');
    expect(rows.map((row) => row.importManaged)).toEqual([true, true, false]);
    expect(rows[1].supplierName).toBe('Supplier');
  });
});

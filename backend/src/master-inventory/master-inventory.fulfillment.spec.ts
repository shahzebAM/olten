jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  return { ...actual, PrismaClient: jest.fn() };
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MasterInventoryController } from './master-inventory.controller';

describe('legacy inventory mutations with tracked stock', () => {
  const product = {
    id: 1,
    company: 'Surgicom',
    sku: 'MED-1',
    currentStock: 10,
  };
  const database = {
    product: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    warehouse: { findFirst: jest.fn(), delete: jest.fn() },
    warehouseLot: { aggregate: jest.fn(), count: jest.fn() },
    customerOrderLine: { count: jest.fn() },
    warehouseBin: { count: jest.fn() },
    warehouseStock: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    inventoryMovement: { updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  let controller: MasterInventoryController;
  beforeEach(() => {
    jest.resetAllMocks();
    database.product.findUnique.mockResolvedValue(product);
    database.product.findFirst.mockResolvedValue(product);
    database.product.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ ...product, ...data }),
    );
    database.warehouseLot.aggregate.mockResolvedValue({
      _sum: { quantity: 0 },
    });
    database.warehouseLot.count.mockResolvedValue(0);
    database.customerOrderLine.count.mockResolvedValue(0);
    database.warehouseBin.count.mockResolvedValue(0);
    database.warehouse.findFirst.mockResolvedValue({
      id: 2,
      company: 'Surgicom',
      status: 'Active',
    });
    database.warehouseStock.findUnique.mockResolvedValue({
      id: 'stock',
      company: 'Surgicom',
      quantity: 5,
    });
    database.warehouseStock.upsert.mockImplementation(
      ({ update }: { update: object }) => Promise.resolve(update),
    );
    database.$transaction.mockImplementation(
      (callback: (tx: typeof database) => Promise<unknown>) =>
        callback(database),
    );
    controller = new MasterInventoryController();
    Object.assign(Reflect.get(controller, 'prisma') as object, database);
  });

  it('preserves catalog edits and no-op quantities for tracked products', async () => {
    database.warehouseLot.count.mockResolvedValue(1);
    await expect(
      controller.updateProduct('1', { name: 'Updated', currentStock: 10 }),
    ).resolves.toMatchObject({ name: 'Updated', currentStock: 10 });
    expect(database.product.update).toHaveBeenCalledTimes(1);
  });

  it.each([9, 11])(
    'rejects legacy absolute quantity %s for a tracked product',
    async (currentStock) => {
      database.warehouseLot.count.mockResolvedValue(1);
      await expect(
        controller.updateProduct('1', { currentStock }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(database.product.update).not.toHaveBeenCalled();
    },
  );

  it('rejects decreases below tracked physical stock even when unreserved', async () => {
    database.warehouseLot.aggregate.mockResolvedValue({
      _sum: { quantity: 8 },
    });
    await expect(
      controller.updateProduct('1', { currentStock: 7 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.product.update).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, '', null, '2x', Number.POSITIVE_INFINITY, 2147483648])(
    'rejects invalid stock %s',
    async (currentStock) => {
      await expect(
        controller.updateProduct('1', { currentStock }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.product.update).not.toHaveBeenCalled();
    },
  );

  it('keeps the new product controls behind the fulfillment endpoint', async () => {
    await controller.updateProduct('1', {
      name: 'Updated',
      expiryControlled: true,
      serialControlled: true,
    });
    expect(database.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name: 'Updated' },
    });
  });

  it('allows an untracked balance update inside a serializable transaction', async () => {
    await expect(
      controller.updateProduct('1', { currentStock: '12' }),
    ).resolves.toMatchObject({ currentStock: 12 });
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(database.$queryRaw).toHaveBeenCalled();
  });

  it.each([-1, 1])(
    'blocks both halves of old multipart transfers when tracked (delta %s)',
    async (quantity) => {
      database.warehouseLot.count.mockResolvedValue(1);
      await expect(
        controller.assignStock({
          productId: 1,
          company: 'Surgicom',
          warehouseId: '2',
          quantity,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(database.warehouseStock.upsert).not.toHaveBeenCalled();
    },
  );

  it('updates a valid untracked hub delta using catalog SKU and the locked current balance', async () => {
    await expect(
      controller.assignStock({
        productId: 1,
        company: 'Surgicom',
        warehouseId: '2',
        quantity: -2,
        sku: 'spoofed',
      }),
    ).resolves.toMatchObject({ quantity: 3 });
    expect(database.warehouseStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sku: 'MED-1',
          quantity: 3,
        }) as unknown,
      }),
    );
  });

  it('rejects negative hub totals and foreign-company balances', async () => {
    await expect(
      controller.assignStock({
        productId: 1,
        company: 'Surgicom',
        warehouseId: '2',
        quantity: -6,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    database.warehouseStock.findUnique.mockResolvedValueOnce({
      company: 'Other',
      quantity: 5,
    });
    await expect(
      controller.assignStock({
        productId: 1,
        company: 'Surgicom',
        warehouseId: '2',
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.warehouseStock.upsert).not.toHaveBeenCalled();
  });

  it('keeps tracked products, facility history and hub balances from being deleted', async () => {
    database.warehouseLot.count.mockResolvedValue(1);
    await expect(controller.removeProduct('1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(controller.removeWarehouse('2')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      controller.clearAllHubStocks('Surgicom'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.product.delete).not.toHaveBeenCalled();
    expect(database.warehouse.delete).not.toHaveBeenCalled();
    expect(database.warehouseStock.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a separately submitted legacy ledger entry for tracked stock', async () => {
    database.warehouseLot.count.mockResolvedValue(1);
    await expect(
      controller.createMovement({
        company: 'Surgicom',
        productId: 1,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('preserves a draft customer order product before any stock lot exists', async () => {
    database.customerOrderLine.count.mockResolvedValueOnce(1);
    await expect(controller.removeProduct('1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(database.product.delete).not.toHaveBeenCalled();
  });
});

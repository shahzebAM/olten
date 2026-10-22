jest.mock('@prisma/client', () => ({
  ...jest.requireActual<typeof import('@prisma/client')>('@prisma/client'),
  PrismaClient: jest.fn(),
}));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { SalesController } from './sales.controller';
import { ProcurementController } from './purchase-orders.controller';

const singleton = (PrismaClient as unknown as jest.Mock).mock
  .instances[0] as object;
describe('Phase 3 party history retention', () => {
  const database = {
    customer: { findUnique: jest.fn(), delete: jest.fn(), update: jest.fn() },
    customerOrder: { count: jest.fn() },
    supplier: { findUnique: jest.fn(), delete: jest.fn() },
    financeDocument: { count: jest.fn() },
    financePayment: { count: jest.fn() },
    paymentRequest: { count: jest.fn() },
    deviceAsset: { count: jest.fn() },
    $transaction: jest.fn(),
  };
  let sales: SalesController;
  let procurement: ProcurementController;
  beforeEach(() => {
    jest.resetAllMocks();
    database.$transaction.mockImplementation(
      (work: (tx: typeof database) => Promise<unknown>) => work(database),
    );
    database.customer.findUnique.mockResolvedValue({ company: 'Olten' });
    database.supplier.findUnique.mockResolvedValue({
      company: 'Olten',
      purchaseOrders: [],
    });
    database.customer.delete.mockResolvedValue({ id: 'customer' });
    database.customer.update.mockResolvedValue({
      id: 'customer',
      company: 'Olten',
      name: 'Updated',
    });
    database.supplier.delete.mockResolvedValue({ id: 'supplier' });
    for (const model of [
      database.customerOrder,
      database.financeDocument,
      database.financePayment,
      database.paymentRequest,
      database.deviceAsset,
    ])
      model.count.mockResolvedValue(0);
    Object.assign(singleton, database);
    sales = new SalesController();
    procurement = new ProcurementController();
    Object.assign(Reflect.get(procurement, 'prisma') as object, database);
  });

  it.each(['financeDocument', 'financePayment', 'deviceAsset'] as const)(
    'retains customers with %s history using their workspace',
    async (model) => {
      database[model].count.mockResolvedValue(1);
      await expect(sales.deleteCustomer('customer')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(database[model].count).toHaveBeenCalledWith({
        where:
          model === 'deviceAsset'
            ? { company: 'Olten', customerId: 'customer' }
            : { company: 'Olten', direction: 'AR', partyId: 'customer' },
      });
      expect(database.customer.delete).not.toHaveBeenCalled();
      expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
    },
  );

  it.each(['financeDocument', 'financePayment', 'paymentRequest'] as const)(
    'retains suppliers with %s history using their workspace',
    async (model) => {
      database[model].count.mockResolvedValue(1);
      await expect(
        procurement.deleteSupplier('supplier'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(database[model].count).toHaveBeenCalledWith({
        where:
          model === 'paymentRequest'
            ? { company: 'Olten', supplierId: 'supplier' }
            : { company: 'Olten', direction: 'AP', partyId: 'supplier' },
      });
      expect(database.supplier.delete).not.toHaveBeenCalled();
      expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
    },
  );

  it('preserves existing fulfillment and purchase order deletion restrictions', async () => {
    database.customerOrder.count.mockResolvedValue(1);
    await expect(sales.deleteCustomer('customer')).rejects.toThrow(
      'fulfillment order history',
    );
    database.supplier.findUnique.mockResolvedValue({
      company: 'Olten',
      purchaseOrders: [{ id: 'po' }],
    });
    await expect(procurement.deleteSupplier('supplier')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(database.customer.delete).not.toHaveBeenCalled();
    expect(database.supplier.delete).not.toHaveBeenCalled();
  });

  it.each(['financeDocument', 'financePayment', 'deviceAsset'] as const)(
    'prevents customer identity changes with %s history but allows ordinary profile edits',
    async (model) => {
      database[model].count.mockResolvedValue(1);
      await expect(
        sales.updateCustomer('customer', { id: 'different' }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        sales.updateCustomer('customer', { company: 'Other' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(database.customer.update).not.toHaveBeenCalled();
      await expect(
        sales.updateCustomer('customer', {
          id: 'customer',
          company: 'Olten',
          name: 'Updated',
        }),
      ).resolves.toMatchObject({ name: 'Updated' });
    },
  );

  it('preserves legacy customer identity edits before Phase 3 history exists', async () => {
    const data = { company: 'Other' };
    await sales.updateCustomer('customer', data);
    expect(database.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer' },
      data,
    });
  });

  it('allows deletion only for parties without retained history', async () => {
    await expect(sales.deleteCustomer('customer')).resolves.toEqual({
      id: 'customer',
    });
    await expect(procurement.deleteSupplier('supplier')).resolves.toEqual({
      id: 'supplier',
    });
    expect(database.customer.delete).toHaveBeenCalledWith({
      where: { id: 'customer' },
    });
    expect(database.supplier.delete).toHaveBeenCalledWith({
      where: { id: 'supplier' },
    });
  });

  it('returns not found for absent parties before history queries', async () => {
    database.customer.findUnique.mockResolvedValue(null);
    database.supplier.findUnique.mockResolvedValue(null);
    await expect(sales.deleteCustomer('customer')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(procurement.deleteSupplier('supplier')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(database.financeDocument.count).not.toHaveBeenCalled();
  });

  it('converts serializable conflicts into a retryable response without masking other failures', async () => {
    database.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: '6',
      }),
    );
    await expect(sales.deleteCustomer('customer')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(procurement.deleteSupplier('supplier')).rejects.toBeInstanceOf(
      ConflictException,
    );
    database.$transaction.mockRejectedValue(new Error('test failure'));
    await expect(sales.deleteCustomer('customer')).rejects.toThrow(
      'test failure',
    );
    await expect(procurement.deleteSupplier('supplier')).rejects.toThrow(
      'test failure',
    );
  });
});

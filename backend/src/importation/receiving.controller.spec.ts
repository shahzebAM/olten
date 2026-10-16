jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  return { ...actual, PrismaClient: jest.fn() };
});

import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthSessionService } from '../auth/auth-session.service';
import {
  ImportReceivingController,
  ReceivingAuthGuard,
} from './receiving.controller';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const poItem = {
  productId: 1,
  sku: 'MED-1',
  productName: 'Medical item',
  po: { supplier: { legalName: 'Supplier' } },
};
const makeLine = (id = 'line-1') => ({
  id,
  acceptedQty: 5,
  placedQty: 0,
  rejectedQty: 2,
  heldQty: 3,
  batchNumber: 'LOT-1',
  expirationDate: day('2026-10-15'),
  shipmentLine: { purchaseOrderItem: poItem },
});
type Line = ReturnType<typeof makeLine>;

describe('QC receipt placement', () => {
  let controller: ImportReceivingController;
  let receipt: {
    id: string;
    company: string;
    grnNumber: string;
    shipment: { shipmentNumber: string };
    items: Line[];
  };
  let master: number;
  let hub: number;
  let ledger: unknown[];
  let lots: Array<Record<string, unknown>>;
  const database = {
    goodsReceipt: { findFirst: jest.fn(), findMany: jest.fn() },
    goodsReceiptLine: { updateMany: jest.fn(), findFirst: jest.fn() },
    product: { findFirst: jest.fn(), update: jest.fn() },
    warehouse: { findFirst: jest.fn() },
    warehouseStock: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    warehouseBin: { findFirst: jest.fn() },
    warehouseLot: { aggregate: jest.fn(), create: jest.fn() },
    inventoryMovement: { create: jest.fn() },
    $transaction: jest.fn(),
    $disconnect: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const place = (
    quantity = 5,
    warehouseId = 'MASTER',
    receiptLineId = 'line-1',
  ) =>
    controller.place('receipt-1', 'Surgicom', 'inspector', {
      placements: [{ receiptLineId, warehouseId, quantity }],
    });

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    // Manila's current date is already October 15 while UTC remains October 14.
    jest.setSystemTime(new Date('2026-10-14T17:00:00.000Z'));
    receipt = {
      id: 'receipt-1',
      company: 'Surgicom',
      grnNumber: 'GRN-2026-000001',
      shipment: { shipmentNumber: 'SHP-2026-000001' },
      items: [makeLine()],
    };
    master = 10;
    hub = 20;
    ledger = [];
    lots = [];
    database.goodsReceipt.findFirst.mockImplementation(
      ({ where }: { where: { id: string; company: string } }) =>
        Promise.resolve(
          where.id === receipt.id && where.company === receipt.company
            ? structuredClone(receipt)
            : null,
        ),
    );
    database.goodsReceipt.findMany.mockImplementation(
      ({ where }: { where: { company: string } }) =>
        Promise.resolve(
          where.company === receipt.company ? [structuredClone(receipt)] : [],
        ),
    );
    database.goodsReceiptLine.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { id: string; placedQty: number; acceptedQty: number };
        data: { placedQty: { increment: number } };
      }) => {
        const line = receipt.items.find(
          (item) =>
            item.id === where.id &&
            item.placedQty === where.placedQty &&
            item.acceptedQty === where.acceptedQty,
        );
        if (line) line.placedQty += data.placedQty.increment;
        return Promise.resolve({ count: line ? 1 : 0 });
      },
    );
    database.goodsReceiptLine.findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(receipt.items.find((item) => item.id === where.id)),
    );
    database.product.findFirst.mockImplementation(() =>
      Promise.resolve({
        id: 1,
        company: 'Surgicom',
        name: 'Medical item',
        sku: 'MED-1',
        currentStock: master,
        expiryControlled: false,
        serialControlled: false,
      }),
    );
    database.warehouseLot.aggregate.mockImplementation(
      ({ where }: { where: { warehouseId: string } }) =>
        Promise.resolve({
          _sum: {
            quantity: lots
              .filter((lot) => lot.warehouseId === where.warehouseId)
              .reduce((sum, lot) => sum + Number(lot.quantity), 0),
          },
        }),
    );
    database.warehouseLot.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        const lot = { id: `lot-${lots.length + 1}`, ...data };
        lots.push(lot);
        return Promise.resolve(lot);
      },
    );
    database.warehouseBin.findFirst.mockResolvedValue({ id: 'bin-1' });
    database.warehouseStock.findFirst.mockResolvedValue({ id: 'hub-stock' });
    database.warehouseStock.findUnique.mockImplementation(() =>
      Promise.resolve({ id: 'hub-stock', company: 'Surgicom', quantity: hub }),
    );
    database.product.update.mockImplementation(
      ({ data }: { data: { currentStock: { increment: number } } }) => {
        master += data.currentStock.increment;
        return Promise.resolve({ currentStock: master });
      },
    );
    database.warehouse.findFirst.mockResolvedValue({
      id: 2,
      company: 'Surgicom',
      status: 'Active',
    });
    database.warehouseStock.upsert.mockImplementation(
      ({ update }: { update: { quantity: { increment: number } } }) => {
        hub += update.quantity.increment;
        return Promise.resolve({
          id: 'hub-stock',
          company: 'Surgicom',
          quantity: hub,
        });
      },
    );
    database.inventoryMovement.create.mockImplementation(
      ({ data }: { data: unknown }) => {
        ledger.push(data);
        return Promise.resolve(data);
      },
    );
    database.$transaction.mockImplementation(
      async (callback: (client: typeof database) => Promise<unknown>) => {
        const snapshot = structuredClone({
          receipt,
          master,
          hub,
          ledger,
          lots,
        });
        try {
          return await callback(database);
        } catch (error) {
          ({ receipt, master, hub, ledger, lots } = snapshot);
          throw error;
        }
      },
    );
    controller = new ImportReceivingController();
    Object.assign(Reflect.get(controller, 'prisma') as object, database);
  });
  afterEach(() => jest.useRealTimers());

  it('places accepted stock into master once and preserves batch, expiry, actor and ledger balances', async () => {
    await expect(place()).resolves.toEqual({
      success: true,
      grnNumber: receipt.grnNumber,
    });
    expect(master).toBe(15);
    expect(lots).toEqual([
      expect.objectContaining({
        receiptLineId: 'line-1',
        warehouseId: 'MASTER',
        quantity: 5,
        warehouseStockId: null,
        batchNumber: 'LOT-1',
        expirationDate: day('2026-10-15'),
      }),
    ]);
    expect(receipt.items[0].placedQty).toBe(5);
    expect(ledger).toEqual([
      expect.objectContaining({
        company: 'Surgicom',
        quantity: 5,
        previousStock: 10,
        newStock: 15,
        user: 'inspector',
        batchNumber: 'LOT-1',
        expirationDate: day('2026-10-15'),
        warehouseId: null,
        lotId: 'lot-1',
      }),
    ]);
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    await expect(place()).rejects.toBeInstanceOf(ConflictException);
    expect(master).toBe(15);
    expect(ledger).toHaveLength(1);
  });

  it('places partial accepted quantities into a same-company warehouse using atomic increments', async () => {
    await place(2, '2');
    expect(master).toBe(10);
    expect(hub).toBe(22);
    expect(lots[0]).toMatchObject({
      warehouseStockId: 'hub-stock',
      warehouseId: '2',
      quantity: 2,
    });
    expect(receipt.items[0].placedQty).toBe(2);
    expect(database.warehouse.findFirst).toHaveBeenCalledWith({
      where: { id: 2, company: 'Surgicom', status: 'Active' },
    });
    expect(database.warehouseStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { warehouseId_productId: { warehouseId: '2', productId: 1 } },
        update: expect.objectContaining({
          quantity: { increment: 2 },
        }) as unknown,
      }),
    );
    expect(ledger).toEqual([
      expect.objectContaining({
        previousStock: 20,
        newStock: 22,
        warehouseId: 2,
      }),
    ]);
    const queue = await controller.queue('Surgicom');
    expect(queue[0].items[0].confirmedQty).toBe(3);
  });

  it('exposes only accepted unplaced quantities, with held and rejected lines excluded', async () => {
    receipt.items.push(
      { ...makeLine('held'), acceptedQty: 0 },
      { ...makeLine('placed'), placedQty: 5 },
    );
    const queue = await controller.queue('Surgicom');
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      goodsReceiptId: 'receipt-1',
      poNumber: receipt.grnNumber,
      supplierName: 'Supplier',
    });
    expect(queue[0].items).toHaveLength(1);
    expect(queue[0].items[0]).toMatchObject({ id: 'line-1', confirmedQty: 5 });
    await expect(place(1, 'MASTER', 'held')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(place(6)).rejects.toBeInstanceOf(ConflictException);
    expect(master).toBe(10);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    'rejects invalid quantity %s before starting a transaction',
    async (quantity) => {
      await expect(place(quantity)).rejects.toBeInstanceOf(BadRequestException);
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['', '-1', '0', '1x', '1.5'])(
    'rejects invalid facility %s',
    async (warehouseId) => {
      await expect(place(1, warehouseId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects duplicate lines and empty placement lists', async () => {
    const entry = {
      receiptLineId: 'line-1',
      quantity: 1,
      warehouseId: 'MASTER',
    };
    await expect(
      controller.place('receipt-1', 'Surgicom', 'user', {
        placements: [entry, entry],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.place('receipt-1', 'Surgicom', 'user', { placements: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('does not load another tenant receipt or a line outside this receipt', async () => {
    await expect(
      controller.place('receipt-1', 'Other', 'user', {
        placements: [
          { receiptLineId: 'line-1', warehouseId: 'MASTER', quantity: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(place(1, 'MASTER', 'other-line')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(database.product.update).not.toHaveBeenCalled();
  });

  it('requires an active product scoped to the authenticated workspace', async () => {
    database.product.findFirst.mockResolvedValueOnce(null);
    await expect(place()).rejects.toBeInstanceOf(BadRequestException);
    expect(database.product.findFirst).toHaveBeenCalledWith({
      where: { id: 1, company: 'Surgicom', deletedAt: null, isActive: true },
    });
    expect(receipt.items[0].placedQty).toBe(0);
  });

  it('rolls back the line claim and previous placements when a later warehouse is unavailable', async () => {
    receipt.items.push(makeLine('line-2'));
    database.warehouse.findFirst.mockResolvedValueOnce(null);
    await expect(
      controller.place('receipt-1', 'Surgicom', 'user', {
        placements: [
          { receiptLineId: 'line-1', warehouseId: 'MASTER', quantity: 2 },
          { receiptLineId: 'line-2', warehouseId: '2', quantity: 2 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(master).toBe(10);
    expect(ledger).toEqual([]);
    expect(receipt.items.map((item) => item.placedQty)).toEqual([0, 0]);
  });

  it('rejects a warehouse balance owned by another company and rolls back its claim', async () => {
    database.warehouseStock.upsert.mockResolvedValueOnce({
      company: 'Other',
      quantity: 25,
    });
    await expect(place(5, '2')).rejects.toBeInstanceOf(ConflictException);
    expect(receipt.items[0].placedQty).toBe(0);
    expect(ledger).toEqual([]);
  });

  it('rejects expired stock while allowing its expiry date throughout the Manila calendar day', async () => {
    receipt.items[0].expirationDate = day('2026-10-14');
    await expect(place()).rejects.toBeInstanceOf(BadRequestException);
    expect(database.goodsReceiptLine.updateMany).not.toHaveBeenCalled();
    receipt.items[0].expirationDate = day('2026-10-15');
    await expect(place()).resolves.toMatchObject({ success: true });
  });

  it('links optional bin and serial details to the receipt lot and ledger', async () => {
    await controller.place('receipt-1', 'Surgicom', 'inspector', {
      placements: [
        {
          receiptLineId: 'line-1',
          warehouseId: 'MASTER',
          quantity: 1,
          binId: 'bin-1',
          serialNumber: ' SERIAL-001 ',
        },
      ],
    });
    expect(lots[0]).toMatchObject({
      binId: 'bin-1',
      serialNumber: 'SERIAL-001',
      quantity: 1,
    });
    expect(ledger[0]).toMatchObject({
      binId: 'bin-1',
      serialNumber: 'SERIAL-001',
      lotId: 'lot-1',
    });
    expect(master).toBe(11);
  });

  it('rolls back aggregate and receipt claim if bin validation fails', async () => {
    database.warehouseBin.findFirst.mockResolvedValueOnce(null);
    await expect(
      controller.place('receipt-1', 'Surgicom', 'inspector', {
        placements: [
          {
            receiptLineId: 'line-1',
            warehouseId: 'MASTER',
            quantity: 1,
            binId: 'foreign-bin',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(master).toBe(10);
    expect(receipt.items[0].placedQty).toBe(0);
    expect(lots).toEqual([]);
    expect(ledger).toEqual([]);
  });

  it('requires a single unit when a serial is supplied and rolls back the aggregate', async () => {
    await expect(
      controller.place('receipt-1', 'Surgicom', 'inspector', {
        placements: [
          {
            receiptLineId: 'line-1',
            warehouseId: 'MASTER',
            quantity: 2,
            serialNumber: 'SERIAL-001',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(master).toBe(10);
    expect(receipt.items[0].placedQty).toBe(0);
    expect(lots).toEqual([]);
  });

  it('returns a conflict if QC or another placement changed the accepted line', async () => {
    database.goodsReceiptLine.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(place()).rejects.toBeInstanceOf(ConflictException);
    expect(database.product.update).not.toHaveBeenCalled();
    expect(ledger).toEqual([]);
  });
});

describe('receiving session guard', () => {
  const sessions = { authenticate: jest.fn(), companyExists: jest.fn() };
  const guard = new ReceivingAuthGuard(
    sessions as unknown as AuthSessionService,
  );
  const context = (request: object) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;
  const user = {
    username: 'actual-user',
    role: 'Admin',
    modules: { inventory: true, companies: { Surgicom: true } },
  };
  beforeEach(() => {
    jest.resetAllMocks();
    sessions.authenticate.mockResolvedValue(user);
    sessions.companyExists.mockResolvedValue(true);
  });

  it.each([
    'inventory',
    'master_inventory',
    'importation',
    'warehouses',
    'warehouse',
  ])(
    'allows %s permission and writes trusted actor/company headers',
    async (permission) => {
      sessions.authenticate.mockResolvedValueOnce({
        ...user,
        modules: { [permission]: true, companies: { Surgicom: true } },
      });
      const request = {
        headers: {
          authorization: 'Bearer session',
          'x-company': ' Surgicom ',
          'x-username': 'spoofed',
        },
      };
      await expect(guard.canActivate(context(request))).resolves.toBe(true);
      expect(request.headers['x-company']).toBe('Surgicom');
      expect(request.headers['x-username']).toBe('actual-user');
    },
  );

  it('rejects a missing verified session', async () => {
    sessions.authenticate.mockRejectedValueOnce(new UnauthorizedException());
    await expect(
      guard.canActivate(context({ headers: { 'x-company': 'Surgicom' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([undefined, '', ['Surgicom'], 'x'.repeat(101)])(
    'rejects invalid company headers',
    async (company) => {
      await expect(
        guard.canActivate(context({ headers: { 'x-company': company } })),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('requires both module and workspace access for ordinary users', async () => {
    await expect(
      guard.canActivate(context({ headers: { 'x-company': 'Other' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    sessions.authenticate.mockResolvedValueOnce({
      ...user,
      modules: { companies: { Surgicom: true } },
    });
    await expect(
      guard.canActivate(context({ headers: { 'x-company': 'Surgicom' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permits Super Admin but requires the workspace to exist', async () => {
    sessions.authenticate.mockResolvedValue({
      ...user,
      role: 'Super Admin',
      modules: {},
    });
    await expect(
      guard.canActivate(context({ headers: { 'x-company': 'Surgicom' } })),
    ).resolves.toBe(true);
    sessions.companyExists.mockResolvedValueOnce(false);
    await expect(
      guard.canActivate(context({ headers: { 'x-company': 'Missing' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

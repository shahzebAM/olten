import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { Response } from 'supertest';
import { AuthSessionModule } from '../src/auth/auth-session.module';
import { AuthSessionService } from '../src/auth/auth-session.service';
import { FulfillmentModule } from '../src/fulfillment/fulfillment.module';
import {
  ImportReceivingController,
  ReceivingAuthGuard,
} from '../src/importation/receiving.controller';
import { MasterInventoryController } from '../src/master-inventory/master-inventory.controller';
import { SalesController } from '../src/sales/sales.controller';

type Order = {
  id: string;
  items: Array<{
    id: string;
    quantity: number;
    reservedQty: number;
    incomingQty: number;
  }>;
};
const json = <T>(response: Response) => response.body as T;

describe('Phase 2 receiving and incoming supply on isolated PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let authorization: string;
  let customerId: string;
  const suffix = randomUUID().slice(0, 12);
  const company = `Phase2 receiving ${suffix}`;
  const actor = `phase2-receiver-${suffix}`;

  beforeAll(async () => {
    const url = process.env.PHASE2_TEST_DATABASE_URL;
    if (!url || url !== process.env.DATABASE_URL)
      throw new Error(
        'Matching isolated Phase 2 test database variables are required.',
      );
    const address = new URL(url);
    if (
      !['localhost', '127.0.0.1'].includes(address.hostname) ||
      address.port !== '55436' ||
      address.pathname !== '/olten_phase2_test'
    )
      throw new Error('Only the named local Phase 2 test database is allowed.');
    db = new PrismaClient();
    await db.company.create({ data: { name: company } });
    const admin = await db.admin.create({
      data: {
        username: actor,
        password: randomUUID(),
        role: 'Admin',
        status: 'Active',
        modules: {
          inventory: true,
          sales: true,
          companies: { [company]: true },
        },
      },
    });
    customerId = (
      await db.customer.create({
        data: {
          id: `P2-QC-${suffix}`,
          name: 'Anonymous receiving hospital',
          company,
        },
      })
    ).id;
    const module = await Test.createTestingModule({
      imports: [AuthSessionModule, FulfillmentModule],
      controllers: [
        ImportReceivingController,
        MasterInventoryController,
        SalesController,
      ],
      providers: [ReceivingAuthGuard],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    authorization = `Bearer ${app.get(AuthSessionService).issue(admin).accessToken}`;
  }, 30000);
  afterAll(async () => {
    if (app) {
      for (const controller of [
        app.get(ImportReceivingController),
        app.get(MasterInventoryController),
      ])
        await (Reflect.get(controller, 'prisma') as PrismaClient).$disconnect();
      await app.close();
    }
    if (db) await db.$disconnect();
  });
  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(app.getHttpServer() as Server)
      [method](path)
      .set('Authorization', authorization)
      .set('x-company', company);
  const product = (tag: string, serialControlled = false) =>
    db.product.create({
      data: {
        company,
        sku: `QC-${tag}-${suffix}`,
        name: `Anonymous ${tag}`,
        category: 'Integration fixture',
        purchasePrice: 1,
        sellingPrice: 2,
        unit: 'piece',
        vatSetting: 'NONE',
        currentStock: 0,
        expiryControlled: true,
        serialControlled,
      },
    });
  const shipment = async (productId: number, tag: string, quantity = 10) => {
    const po = await db.purchaseOrder.create({
      data: {
        company,
        poNumber: `PO-QC-${tag}-${suffix}`,
        status: 'Generated',
        subtotal: quantity,
        grandTotal: quantity,
        createdBy: actor,
        items: {
          create: {
            productId,
            sku: `QC-${tag}`,
            productName: 'Anonymous fixture',
            requestedQty: quantity,
            unitCost: 1,
            lineTotal: quantity,
          },
        },
      },
      include: { items: true },
    });
    const file = await db.importFile.create({
      data: {
        company,
        importNumber: `IMP-QC-${tag}-${suffix}`,
        title: 'Anonymous test import',
        createdBy: actor,
      },
    });
    return db.shipment.create({
      data: {
        company,
        shipmentNumber: `SHP-QC-${tag}-${suffix}`,
        importFileId: file.id,
        mode: 'Air',
        status: 'Arrived',
        createdBy: actor,
        items: {
          create: { purchaseOrderItemId: po.items[0].id, shippedQty: quantity },
        },
      },
      include: { items: true },
    });
  };

  it('places only accepted quantities into bin lots once, retains GRN evidence and protects aggregate writes', async () => {
    const item = await product('accepted');
    const supply = await shipment(item.id, 'accepted');
    const receipt = await db.goodsReceipt.create({
      data: {
        company,
        grnNumber: `GRN-QC-${suffix}`,
        shipmentId: supply.id,
        createdBy: actor,
        items: {
          create: {
            shipmentLineId: supply.items[0].id,
            receivedQty: 10,
            acceptedQty: 5,
            rejectedQty: 2,
            heldQty: 3,
            batchNumber: 'BATCH-QC',
            expirationDate: new Date('2099-10-16'),
            inspectedBy: actor,
          },
        },
      },
      include: { items: true },
    });
    const bin = json<{ id: string }>(
      await api('post', '/fulfillment/bins')
        .send({
          warehouseId: 'MASTER',
          building: 'WH1',
          floor: 'F2',
          zone: 'ZA',
          rack: 'R03',
          shelf: 'S02',
          bin: 'B04',
        })
        .expect(201),
    );
    const payload = {
      placements: [
        {
          receiptLineId: receipt.items[0].id,
          warehouseId: 'MASTER',
          binId: bin.id,
          quantity: 3,
        },
      ],
    };
    await api('post', `/importation/receipts/${receipt.id}/place`)
      .send(payload)
      .expect(201);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(3);
    const lots = await db.warehouseLot.findMany({
      where: { company, receiptLineId: receipt.items[0].id },
    });
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      quantity: 3,
      reservedQty: 0,
      binId: bin.id,
      batchNumber: 'BATCH-QC',
      warehouseStockId: null,
    });
    expect(lots[0].expirationDate?.toISOString().slice(0, 10)).toBe(
      '2099-10-16',
    );
    const ledger = await db.inventoryMovement.findFirstOrThrow({
      where: { company, productId: item.id },
    });
    expect(ledger).toMatchObject({
      lotId: lots[0].id,
      binId: bin.id,
      reference: receipt.grnNumber,
      user: actor,
      previousStock: 0,
      newStock: 3,
    });
    await api('post', `/importation/receipts/${receipt.id}/place`)
      .send(payload)
      .expect(409);
    await api('patch', `/products/${item.id}`)
      .send({ currentStock: 4 })
      .expect(409);
    const hub = await db.warehouse.create({
      data: { company, name: 'QC test hub', address: 'Local fixture' },
    });
    await api('post', '/warehouse-stock')
      .send({
        company,
        warehouseId: String(hub.id),
        productId: item.id,
        quantity: 1,
      })
      .expect(409);
    expect(
      await db.warehouseStock.count({ where: { company, productId: item.id } }),
    ).toBe(0);
    const view = json<{
      qcBalances: Array<{
        receiptLineId: string;
        quarantineQty: number;
        rejectedQty: number;
        acceptedUnplacedQty: number;
      }>;
    }>(await api('get', '/fulfillment/overview').expect(200));
    expect(
      view.qcBalances.find(
        (line) => line.receiptLineId === receipt.items[0].id,
      ),
    ).toMatchObject({
      quarantineQty: 3,
      rejectedQty: 2,
      acceptedUnplacedQty: 2,
    });
  });

  it('requires one unique serial per placement and rolls back a duplicate serial claim', async () => {
    const item = await product('serial', true);
    const supply = await shipment(item.id, 'serial', 2);
    const receipt = await db.goodsReceipt.create({
      data: {
        company,
        grnNumber: `GRN-SERIAL-${suffix}`,
        shipmentId: supply.id,
        createdBy: actor,
        items: {
          create: {
            shipmentLineId: supply.items[0].id,
            receivedQty: 2,
            acceptedQty: 2,
            rejectedQty: 0,
            heldQty: 0,
            batchNumber: 'SERIAL-BATCH',
            expirationDate: new Date('2099-10-16'),
            inspectedBy: actor,
          },
        },
      },
      include: { items: true },
    });
    const place = (quantity: number, serialNumber?: string) =>
      api('post', `/importation/receipts/${receipt.id}/place`).send({
        placements: [
          {
            receiptLineId: receipt.items[0].id,
            warehouseId: 'MASTER',
            quantity,
            serialNumber,
          },
        ],
      });
    await place(2).expect(400);
    await place(1, 'SERIAL-001').expect(201);
    await place(1, 'SERIAL-001').expect(409);
    expect(
      (
        await db.goodsReceiptLine.findUniqueOrThrow({
          where: { id: receipt.items[0].id },
        })
      ).placedQty,
    ).toBe(1);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(1);
    await place(1, 'SERIAL-002').expect(201);
    expect(
      await db.warehouseLot.count({ where: { company, productId: item.id } }),
    ).toBe(2);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(2);
  });

  it('bounds incoming allocations by both total order demand and shipment remainder, and releases them', async () => {
    const item = await product('incoming');
    const first = await shipment(item.id, 'incoming-a', 10);
    const second = await shipment(item.id, 'incoming-b', 8);
    const create = async (po: string) => {
      const source = await db.orderSlip.create({
        data: {
          company,
          customerId,
          osNumber: `OS-${po}-${suffix}`,
          createdBy: actor,
          subtotal: 20,
          vatAmount: 0,
          grandTotal: 20,
          items: {
            create: [
              {
                productId: item.id,
                sku: item.sku,
                productName: item.name,
                requestedQty: 10,
                unitPrice: 2,
                lineTotal: 20,
              },
            ],
          },
        },
      });
      return json<Order>(
        await api('post', `/fulfillment/order-slips/${source.id}/approve`)
          .send({})
          .expect(201),
      );
    };
    const order = await create('INCOMING-A');
    const other = await create('INCOMING-B');
    await api('delete', `/products/${item.id}`).expect(409);
    await api('delete', `/sales/customers/${customerId}`).expect(409);
    const allocate = (
      target: Order,
      shipmentLineId: string,
      quantity: number,
    ) =>
      api('post', `/fulfillment/orders/${target.id}/incoming`).send({
        orderLineId: target.items[0].id,
        shipmentLineId,
        quantity,
      });
    await allocate(order, first.items[0].id, 6).expect(201);
    await allocate(order, second.items[0].id, 5).expect(409);
    await allocate(order, second.items[0].id, 4).expect(201);
    await allocate(other, first.items[0].id, 5).expect(409);
    await allocate(other, first.items[0].id, 4).expect(201);
    const receipt = await db.goodsReceipt.create({
      data: {
        company,
        grnNumber: `GRN-INCOMING-${suffix}`,
        shipmentId: first.id,
        createdBy: actor,
        items: {
          create: {
            shipmentLineId: first.items[0].id,
            receivedQty: 7,
            acceptedQty: 5,
            heldQty: 2,
            rejectedQty: 0,
            expirationDate: new Date('2099-10-16'),
            inspectedBy: actor,
          },
        },
      },
      include: { items: true },
    });
    let view = json<{ orders: Order[] }>(
      await api('get', '/fulfillment/overview').expect(200),
    );
    const demand = view.orders.filter((row) =>
      [order.id, other.id].includes(row.id),
    );
    expect(demand.reduce((sum, row) => sum + row.items[0].incomingQty, 0)).toBe(
      7,
    ); // First shipment 3 outstanding + second allocation 4.
    await api('post', `/importation/receipts/${receipt.id}/place`)
      .send({
        placements: [
          {
            receiptLineId: receipt.items[0].id,
            warehouseId: 'MASTER',
            quantity: 5,
          },
        ],
      })
      .expect(201);
    await api('post', `/fulfillment/orders/${order.id}/reserve`)
      .send({})
      .expect(201);
    view = json<{ orders: Order[] }>(
      await api('get', '/fulfillment/overview').expect(200),
    );
    const current = view.orders.find((row) => row.id === order.id)!;
    expect(current.items[0].reservedQty).toBe(5);
    expect(
      current.items[0].reservedQty + current.items[0].incomingQty,
    ).toBeLessThanOrEqual(10);
    await allocate(order, first.items[0].id, 0).expect(201);
    expect(
      await db.incomingAllocation.count({
        where: {
          orderLineId: order.items[0].id,
          shipmentLineId: first.items[0].id,
        },
      }),
    ).toBe(0);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(5);
  }, 30000);
});

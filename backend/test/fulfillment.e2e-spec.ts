import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthSessionModule } from '../src/auth/auth-session.module';
import { AuthSessionService } from '../src/auth/auth-session.service';
import { FulfillmentModule } from '../src/fulfillment/fulfillment.module';
import { OrderSlipsController } from '../src/sales/order-slips.controller';
import { PackingListsController } from '../src/sales/packing-lists.controller';
import { ProcurementController } from '../src/sales/purchase-orders.controller';

type Pick = {
  id: string;
  lotId: string;
  quantity: number;
  lot: {
    batchNumber: string | null;
    serialNumber: string | null;
    binId: string | null;
  };
};

type JsonBody = {
  id: string;
  code: string;
  osNumber: string;
  soNumber: string;
  status: string;
  items: { picks: Pick[] }[];
  lines: { id: string; countedQty: number | null }[];
  [productId: number]: {
    officeStock: number;
    warehouseQty: number;
    availableQty: number;
    reservedQty: number;
  };
};

function json(response: { text: string }): JsonBody {
  return JSON.parse(response.text) as JsonBody;
}

describe('Phase 2 real PostgreSQL fulfillment workflow', () => {
  let app: INestApplication<App>;
  let db: PrismaClient;
  let authorization: string;
  let clerkAuthorization: string;
  let warehouseAuthorization: string;
  let customerId: string;
  const suffix = randomUUID().slice(0, 12);
  const company = `Phase2 isolated ${suffix}`;
  const otherCompany = `Phase2 foreign ${suffix}`;

  beforeAll(async () => {
    const target = process.env.PHASE2_TEST_DATABASE_URL;
    if (!target || target !== process.env.DATABASE_URL)
      throw new Error(
        'Set matching PHASE2_TEST_DATABASE_URL and DATABASE_URL for the dedicated Phase 2 test database.',
      );
    const address = new URL(target);
    if (
      !['localhost', '127.0.0.1'].includes(address.hostname) ||
      address.port !== '55436' ||
      address.pathname !== '/olten_phase2_test'
    ) {
      throw new Error(
        'Phase 2 integration tests require the isolated localhost:55436/olten_phase2_test database.',
      );
    }
    db = new PrismaClient();
    await db.company.createMany({
      data: [{ name: company }, { name: otherCompany }],
    });
    const admin = await db.admin.create({
      data: {
        username: `phase2-admin-${suffix}`,
        password: randomUUID(),
        role: 'Super Admin',
        status: 'Active',
        modules: {},
      },
    });
    const clerk = await db.admin.create({
      data: {
        username: `phase2-clerk-${suffix}`,
        password: randomUUID(),
        role: 'Clerk',
        status: 'Active',
        modules: { sales: true, companies: { [company]: true } },
      },
    });
    const warehouseUser = await db.admin.create({
      data: {
        username: `phase2-warehouse-${suffix}`,
        password: randomUUID(),
        role: 'Admin',
        status: 'Active',
        modules: { inventory: true, companies: { [company]: true } },
      },
    });
    const customer = await db.customer.create({
      data: {
        id: `P2-${suffix}`,
        company,
        name: 'Anonymous integration hospital',
      },
    });
    customerId = customer.id;
    const module = await Test.createTestingModule({
      imports: [AuthSessionModule, FulfillmentModule],
      controllers: [
        OrderSlipsController,
        PackingListsController,
        ProcurementController,
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    const sessions = app.get(AuthSessionService);
    authorization = `Bearer ${sessions.issue(admin).accessToken}`;
    clerkAuthorization = `Bearer ${sessions.issue(clerk).accessToken}`;
    warehouseAuthorization = `Bearer ${sessions.issue(warehouseUser).accessToken}`;
  }, 30000);

  afterAll(async () => {
    if (app) {
      for (const controller of [
        app.get(OrderSlipsController),
        app.get(PackingListsController),
        app.get(ProcurementController),
      ]) {
        await (Reflect.get(controller, 'prisma') as PrismaClient).$disconnect();
      }
      await app.close();
    }
    if (db) await db.$disconnect();
  });

  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    tenant = company,
    token?: string,
  ) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', token ?? authorization)
      .set('x-company', tenant);
  const product = (tag: string, quantity: number, expiryControlled = false) =>
    db.product.create({
      data: {
        company,
        sku: `P2-${tag}-${suffix}`,
        name: `Anonymous ${tag}`,
        category: 'Integration fixture',
        purchasePrice: 5,
        sellingPrice: 12.5,
        unit: 'piece',
        vatSetting: 'VAT',
        currentStock: quantity,
        expiryControlled,
      },
    });
  const osBody = (id: number, tag: string, quantity: number) => ({
    company: 'Forged company',
    user: 'forged-user',
    osNumber: `OS-${tag}-${suffix}`,
    customerId,
    isVatApplied: true,
    vatRate: 0.12,
    items: [{ productId: id, requestedQty: quantity, unitPrice: 12.5 }],
  });

  it('reserves FEFO across bins, shares FO/PL dispatch, decrements only on dispatch and accepts partial POD', async () => {
    const item = await product('fefo', 12, true);
    const warehouse = await db.warehouse.create({
      data: { company, name: `WH-${suffix}`, address: 'Test fixture only' },
    });
    const hub = await db.warehouseStock.create({
      data: {
        company,
        warehouseId: String(warehouse.id),
        productId: item.id,
        sku: item.sku,
        quantity: 8,
      },
    });
    const bin = await api('post', '/fulfillment/bins')
      .send({
        warehouseId: String(warehouse.id),
        building: 'WH1',
        floor: 'F2',
        zone: 'ZA',
        rack: 'R03',
        shelf: 'S02',
        bin: 'B04',
      })
      .expect(201);
    expect(json(bin).code).toBe('WH1-F2-ZA-R03-S02-B04');
    await api('post', '/fulfillment/lots/register')
      .send({
        productId: item.id,
        warehouseId: 'MASTER',
        quantity: 2,
        batchNumber: 'EXPIRED',
        expirationDate: '2020-01-01',
      })
      .expect(201);
    const early = await api('post', '/fulfillment/lots/register')
      .send({
        productId: item.id,
        warehouseId: String(warehouse.id),
        binId: json(bin).id,
        quantity: 4,
        batchNumber: 'EARLY',
        expirationDate: '2098-10-17',
      })
      .expect(201);
    const later = await api('post', '/fulfillment/lots/register')
      .send({
        productId: item.id,
        warehouseId: 'MASTER',
        quantity: 5,
        batchNumber: 'LATER',
        expirationDate: '2099-10-17',
      })
      .expect(201);
    await api('post', '/fulfillment/lots/register')
      .send({
        productId: item.id,
        warehouseId: 'MASTER',
        quantity: 3,
        batchNumber: 'HOLD',
        expirationDate: '2099-10-17',
        status: 'QUARANTINE',
      })
      .expect(201);
    const saved = await api('post', '/sales/order-slips')
      .send(osBody(item.id, 'fefo', 7))
      .expect(201);
    await api('post', '/sales/order-slips', company, warehouseAuthorization)
      .send(osBody(item.id, 'warehouse-denied', 1))
      .expect(403);
    await api('post', '/sales/packing-lists', company, warehouseAuthorization)
      .send({})
      .expect(403);
    expect(json(saved)).toMatchObject({
      company,
      status: 'Generated',
      subtotal: '87.5',
      vatAmount: '10.5',
      grandTotal: '98',
    });
    expect(
      await db.stockReservation.count({
        where: { orderLine: { order: { company } } },
      }),
    ).toBe(0);
    await request(app.getHttpServer())
      .post(`/fulfillment/order-slips/${json(saved).id}/approve`)
      .set('x-company', company)
      .send({})
      .expect(401);
    await api(
      'post',
      `/fulfillment/order-slips/${json(saved).id}/approve`,
      company,
      clerkAuthorization,
    )
      .send({})
      .expect(403);
    const approval = await api(
      'post',
      `/fulfillment/order-slips/${json(saved).id}/approve`,
    )
      .send({})
      .expect(201);
    expect(json(approval)).toMatchObject({
      status: 'Open',
      sourceOrderSlipId: json(saved).id,
    });
    expect(json(approval).soNumber).toMatch(/^SO-\d{4}-\d{6}$/);
    const reservations = await db.stockReservation.findMany({
      where: { orderLine: { orderId: json(approval).id, order: { company } } },
      orderBy: { quantity: 'desc' },
    });
    expect(reservations.map((row) => [row.lotId, row.quantity])).toEqual([
      [json(early).id, 4],
      [json(later).id, 3],
    ]);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(12);
    expect(
      (await db.warehouseStock.findUniqueOrThrow({ where: { id: hub.id } }))
        .quantity,
    ).toBe(8);
    const stock = await api('post', '/sales/order-slips/refresh-stock')
      .send({ company: 'Forged company', productIds: [item.id] })
      .expect(201);
    expect(json(stock)[item.id]).toMatchObject({
      officeStock: 2,
      warehouseQty: 0,
      availableQty: 2,
      reservedQty: 7,
    });
    const body = {
      ...osBody(item.id, 'fefo', 7),
      referenceOs: json(saved).osNumber,
      osNumber: `FO-fefo-${suffix}`,
    };
    const final = await api('post', '/sales/order-slips')
      .send(body)
      .expect(201);
    const packing = await api('post', '/sales/packing-lists')
      .send({
        ...body,
        plNumber: `PL-fefo-${suffix}`,
        subtotal: 87.5,
        vatAmount: 10.5,
        grandTotal: 98,
        items: [
          {
            productId: item.id,
            sku: item.sku,
            productName: item.name,
            requestedQty: 7,
            unitPrice: 12.5,
            lineTotal: 87.5,
          },
        ],
      })
      .expect(201);
    const sources = await db.deliverySource.findMany({
      where: { company, sourceId: { in: [json(final).id, json(packing).id] } },
    });
    expect(sources).toHaveLength(2);
    expect(new Set(sources.map((source) => source.deliveryId)).size).toBe(1);
    const deliveryId = sources[0].deliveryId;
    expect(
      await db.inventoryMovement.count({
        where: { company, productId: item.id, type: 'DISPATCH' },
      }),
    ).toBe(0);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(12);
    await api('post', `/fulfillment/deliveries/${deliveryId}/dispatch`)
      .send({})
      .expect(409);
    const picking = await api(
      'post',
      `/fulfillment/deliveries/${deliveryId}/pick-list`,
    )
      .send({})
      .expect(201);
    const picks = json(picking).items[0].picks;
    expect(picks.map((pick) => [pick.lotId, pick.quantity])).toEqual([
      [json(early).id, 4],
      [json(later).id, 3],
    ]);
    await api(
      'post',
      `/fulfillment/deliveries/${deliveryId}/picks/${picks[0].id}/verify`,
    )
      .send({
        scan: 'WRONG-SKU',
        quantity: picks[0].quantity,
        batchNumber: 'EARLY',
        binId: json(bin).id,
      })
      .expect(400);
    for (const pick of picks) {
      await api(
        'post',
        `/fulfillment/deliveries/${deliveryId}/picks/${pick.id}/verify`,
      )
        .send({
          scan: `${item.sku}  ${item.name}`,
          quantity: pick.quantity,
          batchNumber: pick.lot.batchNumber,
          binId: pick.lot.binId,
        })
        .expect(201);
    }
    await api('patch', `/fulfillment/deliveries/${deliveryId}/schedule`)
      .send({
        scheduledAt: new Date().toISOString(),
        carrier: 'Integration carrier',
      })
      .expect(200);
    await api('post', `/fulfillment/deliveries/${deliveryId}/dispatch`)
      .send({})
      .expect(201);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(9);
    expect(
      (await db.warehouseStock.findUniqueOrThrow({ where: { id: hub.id } }))
        .quantity,
    ).toBe(4);
    expect(
      (
        await db.warehouseLot.findUniqueOrThrow({
          where: { id: json(early).id },
        })
      ).quantity,
    ).toBe(0);
    const movements = await db.inventoryMovement.findMany({
      where: { company, productId: item.id, type: 'DISPATCH' },
    });
    expect(movements).toHaveLength(2);
    expect(movements.reduce((total, row) => total + row.quantity, 0)).toBe(7);
    expect(
      movements.some(
        (row) => row.binId === json(bin).id && row.batchNumber === 'EARLY',
      ),
    ).toBe(true);
    await api('post', `/fulfillment/deliveries/${deliveryId}/dispatch`)
      .send({})
      .expect(201);
    expect(
      await db.inventoryMovement.count({
        where: { company, productId: item.id, type: 'DISPATCH' },
      }),
    ).toBe(2);
    await api('delete', `/sales/order-slips/${json(final).id}/cancel`).expect(
      409,
    );
    await api('delete', `/sales/packing-lists/${json(packing).id}`).expect(409);
    const deliveryLine = await db.deliveryItem.findFirstOrThrow({
      where: { deliveryId },
    });
    const receipt = {
      recipient: 'Hospital receiver',
      receivedAt: new Date(Date.now() + 1000).toISOString(),
      receiptUrl: 'https://example.test/signed-integration-pod.pdf',
    };
    const partial = await api(
      'post',
      `/fulfillment/deliveries/${deliveryId}/pod`,
    )
      .send({
        ...receipt,
        items: [{ deliveryItemId: deliveryLine.id, quantity: 2 }],
      })
      .expect(201);
    expect(json(partial).status).toBe('PartiallyDelivered');
    await api('post', `/fulfillment/deliveries/${deliveryId}/pod`)
      .send({
        ...receipt,
        items: [{ deliveryItemId: deliveryLine.id, quantity: 2 }],
      })
      .expect(201);
    expect(
      (
        await db.deliveryItem.findUniqueOrThrow({
          where: { id: deliveryLine.id },
        })
      ).deliveredQty,
    ).toBe(2);
    expect(await db.deliveryPod.count({ where: { deliveryId } })).toBe(1);
    await api('post', `/fulfillment/deliveries/${deliveryId}/pod`)
      .send({
        ...receipt,
        items: [{ deliveryItemId: deliveryLine.id, quantity: 6 }],
      })
      .expect(409);
    const complete = await api(
      'post',
      `/fulfillment/deliveries/${deliveryId}/pod`,
    )
      .send({
        ...receipt,
        items: [{ deliveryItemId: deliveryLine.id, quantity: 5 }],
      })
      .expect(201);
    expect(json(complete).status).toBe('Delivered');
    await api('post', `/fulfillment/deliveries/${deliveryId}/pod`)
      .send({
        ...receipt,
        items: [{ deliveryItemId: deliveryLine.id, quantity: 5 }],
      })
      .expect(201);
    expect(await db.deliveryPod.count({ where: { deliveryId } })).toBe(2);
    expect(
      (
        await db.customerOrder.findUniqueOrThrow({
          where: { id: json(approval).id },
        })
      ).status,
    ).toBe('Completed');
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(9);
    await api(
      'get',
      `/fulfillment/deliveries/${deliveryId}`,
      otherCompany,
    ).expect(404);
  }, 30000);

  it('rejects standalone customer POs without creating a second order', async () => {
    const before = await db.customerOrder.count({ where: { company } });
    await api('post', '/fulfillment/orders')
      .send({
        customerId,
        hospitalPoNumber: `DIRECT-${suffix}`,
        items: [{ productId: 1, quantity: 1 }],
      })
      .expect(400);
    expect(await db.customerOrder.count({ where: { company } })).toBe(before);
  });

  it('requires a valid OS for simple POs and continues a user-entered number on PostgreSQL', async () => {
    const item = await product('po-number', 0);
    const saved = await api('post', '/sales/order-slips')
      .send(osBody(item.id, 'po-number', 2))
      .expect(201);
    const body = {
      company,
      user: 'integration',
      poNumber: `${suffix}-001526`,
      osReference: json(saved).osNumber,
      isVatApplied: true,
      items: [
        {
          productId: item.id,
          sku: item.sku,
          productName: item.name,
          requestedQty: 2,
          unitCost: 12.5,
        },
      ],
    };
    await api('post', '/procurement/purchase-orders')
      .send({ ...body, osReference: '' })
      .expect(400);
    await api('post', '/procurement/purchase-orders')
      .send({ ...body, osReference: 'OS-missing' })
      .expect(400);
    const po = await api('post', '/procurement/purchase-orders')
      .send(body)
      .expect(201);
    expect(po.body).toMatchObject({
      poNumber: body.poNumber,
      osReference: body.osReference,
      subtotal: 25,
      vatAmount: 3,
      grandTotal: 28,
    });
    const next = await api('get', '/procurement/purchase-orders/next-po-number')
      .query({ company })
      .expect(200);
    expect(next.body).toEqual({ poNumber: `${suffix}-001527` });
    await api('post', '/procurement/purchase-orders').send(body).expect(400);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(0);
  });

  it('does not oversell under competing reservation transactions', async () => {
    const item = await product('concurrency', 1);
    const first = await api('post', '/sales/order-slips')
      .send(osBody(item.id, 'concurrency-a', 1))
      .expect(201);
    const second = await api('post', '/sales/order-slips')
      .send(osBody(item.id, 'concurrency-b', 1))
      .expect(201);
    const results = await Promise.all([
      api('post', `/fulfillment/order-slips/${json(first).id}/approve`).send(
        {},
      ),
      api('post', `/fulfillment/order-slips/${json(second).id}/approve`).send(
        {},
      ),
    ]);
    expect(results.every((result) => [201, 409].includes(result.status))).toBe(
      true,
    );
    expect(results.some((result) => result.status === 201)).toBe(true);
    const reservations = await db.stockReservation.findMany({
      where: { orderLine: { productId: item.id, order: { company } } },
    });
    expect(
      reservations.reduce(
        (total, row) =>
          total + row.quantity - row.releasedQty - row.dispatchedQty,
        0,
      ),
    ).toBe(1);
    expect(
      (
        await db.warehouseLot.aggregate({
          where: { company, productId: item.id },
          _sum: { reservedQty: true },
        })
      )._sum.reservedQty,
    ).toBe(1);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(1);
  }, 30000);

  it('retains permanent Phase 2 markers through cancel and delete without phantom restoration', async () => {
    const item = await product('cancel', 3);
    const saved = await api('post', '/sales/order-slips')
      .send(osBody(item.id, 'cancel', 2))
      .expect(201);
    const order = await api(
      'post',
      `/fulfillment/order-slips/${json(saved).id}/approve`,
    )
      .send({})
      .expect(201);
    const body = {
      ...osBody(item.id, 'cancel', 2),
      referenceOs: json(saved).osNumber,
      osNumber: `FO-cancel-${suffix}`,
    };
    const final = await api('post', '/sales/order-slips')
      .send(body)
      .expect(201);
    const packing = await api('post', '/sales/packing-lists')
      .send({
        ...body,
        plNumber: `PL-cancel-${suffix}`,
        subtotal: 25,
        vatAmount: 3,
        grandTotal: 28,
        items: [
          {
            productId: item.id,
            sku: item.sku,
            productName: item.name,
            requestedQty: 2,
            unitPrice: 12.5,
            lineTotal: 25,
          },
        ],
      })
      .expect(201);
    const source = await db.deliverySource.findFirstOrThrow({
      where: { company, sourceType: 'FO', sourceId: json(final).id },
    });
    await api('delete', `/sales/order-slips/${json(final).id}/cancel`).expect(
      200,
    );
    await api('delete', `/sales/order-slips/${json(final).id}/cancel`).expect(
      200,
    );
    expect(
      (
        await db.delivery.findUniqueOrThrow({
          where: { id: source.deliveryId },
        })
      ).status,
    ).toBe('Draft');
    await api('delete', `/sales/order-slips/${json(final).id}`).expect(200);
    await api('delete', `/sales/packing-lists/${json(packing).id}`).expect(200);
    expect(
      (
        await db.delivery.findUniqueOrThrow({
          where: { id: source.deliveryId },
        })
      ).status,
    ).toBe('Cancelled');
    expect(
      await db.deliverySource.count({
        where: {
          company,
          sourceId: json(final).id,
          cancelledAt: { not: null },
        },
      }),
    ).toBe(1);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(3);
    await api('post', `/fulfillment/orders/${json(order).id}/cancel`)
      .send({})
      .expect(201);
    expect(
      (
        await db.warehouseLot.aggregate({
          where: { company, productId: item.id },
          _sum: { reservedQty: true },
        })
      )._sum.reservedQty,
    ).toBe(0);
  }, 30000);

  it('preserves one-time stock restoration for historical FO and PL documents', async () => {
    const item = await product('historic', 4);
    const final = await db.orderSlip.create({
      data: {
        company,
        customerId,
        osNumber: `FO-legacy-${suffix}`,
        createdBy: 'Historic fixture',
        status: 'Generated',
        subtotal: 25,
        vatAmount: 3,
        grandTotal: 28,
        items: {
          create: {
            productId: item.id,
            sku: item.sku,
            productName: item.name,
            requestedQty: 2,
            unitPrice: 12.5,
            lineTotal: 25,
          },
        },
      },
    });
    await api('delete', `/sales/order-slips/${final.id}/cancel`).expect(200);
    await api('delete', `/sales/order-slips/${final.id}/cancel`).expect(200);
    await api('delete', `/sales/order-slips/${final.id}`).expect(200);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(6);
    const packing = await db.packingList.create({
      data: {
        company,
        customerId,
        plNumber: `PL-legacy-${suffix}`,
        createdBy: 'Historic fixture',
        subtotal: 12.5,
        vatAmount: 1.5,
        grandTotal: 14,
        items: {
          create: {
            productId: item.id,
            sku: item.sku,
            productName: item.name,
            requestedQty: 1,
            unitPrice: 12.5,
            lineTotal: 12.5,
          },
        },
      },
    });
    await api('delete', `/sales/packing-lists/${packing.id}/cancel`).expect(
      200,
    );
    await api('delete', `/sales/packing-lists/${packing.id}/cancel`).expect(
      200,
    );
    await api('delete', `/sales/packing-lists/${packing.id}`).expect(200);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(7);
  }, 30000);
  it('rejects stale cycle counts, requires recount approval and preserves reserved stock', async () => {
    const item = await product('count', 5);
    const registered = await api('post', '/fulfillment/lots/register')
      .send({
        productId: item.id,
        warehouseId: 'MASTER',
        quantity: 5,
        batchNumber: 'COUNT',
      })
      .expect(201);
    const lotId = json(registered).id;
    const count = await api('post', '/fulfillment/cycle-counts')
      .send({ lotIds: [lotId], notes: 'Anonymous physical count' })
      .expect(201);
    const countId = json(count).id;
    const lineId = json(count).lines[0].id;
    expect(json(count).status).toBe('Draft');
    await api('post', `/fulfillment/cycle-counts/${countId}/submit`)
      .send({})
      .expect(400);
    await api('patch', `/fulfillment/cycle-counts/${countId}/lines/${lineId}`)
      .send({ countedQty: 4, scan: 'WRONG' })
      .expect(400);
    await api('patch', `/fulfillment/cycle-counts/${countId}/lines/${lineId}`)
      .send({ countedQty: 4, scan: item.sku })
      .expect(200);
    await api('post', `/fulfillment/cycle-counts/${countId}/submit`)
      .send({})
      .expect(201);
    await api('post', `/fulfillment/lots/${lotId}/status`)
      .send({ status: 'DAMAGED' })
      .expect(201);
    await api('post', `/fulfillment/cycle-counts/${countId}/approve`)
      .send({})
      .expect(409);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(5);
    await api(
      'post',
      `/fulfillment/cycle-counts/${countId}/recount`,
      company,
      clerkAuthorization,
    )
      .send({ reason: 'Recheck' })
      .expect(403);
    const recount = await api(
      'post',
      `/fulfillment/cycle-counts/${countId}/recount`,
    )
      .send({ reason: 'Stock classification changed during count' })
      .expect(201);
    expect(json(recount).status).toBe('RecountRequired');
    expect(json(recount).lines[0].countedQty).toBeNull();
    await api('patch', `/fulfillment/cycle-counts/${countId}/lines/${lineId}`)
      .send({ countedQty: 4, scan: item.sku })
      .expect(200);
    await api('post', `/fulfillment/cycle-counts/${countId}/submit`)
      .send({})
      .expect(201);
    await api(
      'post',
      `/fulfillment/cycle-counts/${countId}/approve`,
      company,
      clerkAuthorization,
    )
      .send({})
      .expect(403);
    const approved = await api(
      'post',
      `/fulfillment/cycle-counts/${countId}/approve`,
    )
      .send({})
      .expect(201);
    expect(json(approved).status).toBe('Approved');
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(4);
    const adjustment = await db.inventoryMovement.findFirstOrThrow({
      where: { company, productId: item.id, type: 'ADJUST' },
    });
    expect(adjustment).toMatchObject({
      previousStock: 5,
      newStock: 4,
      quantity: 1,
      batchNumber: 'COUNT',
      lotId,
    });
    expect(adjustment.reference).toMatch(/^ADJ-\d{4}-\d{6}$/);
    await api('post', `/fulfillment/cycle-counts/${countId}/approve`)
      .send({})
      .expect(201);
    expect(
      await db.inventoryMovement.count({
        where: { company, productId: item.id, type: 'ADJUST' },
      }),
    ).toBe(1);
    await api('post', `/fulfillment/lots/${lotId}/status`)
      .send({ status: 'AVAILABLE' })
      .expect(201);
    const source = await api('post', '/sales/order-slips')
      .send(osBody(item.id, 'count-reservation', 3))
      .expect(201);
    const order = await api(
      'post',
      `/fulfillment/order-slips/${json(source).id}/approve`,
    )
      .send({})
      .expect(201);
    await api('post', `/fulfillment/orders/${json(order).id}/reserve`)
      .send({})
      .expect(201);
    const reservedCount = await api('post', '/fulfillment/cycle-counts')
      .send({ lotIds: [lotId] })
      .expect(201);
    const reservedCountId = json(reservedCount).id;
    await api(
      'patch',
      `/fulfillment/cycle-counts/${reservedCountId}/lines/${json(reservedCount).lines[0].id}`,
    )
      .send({ countedQty: 2, scan: item.sku })
      .expect(200);
    await api('post', `/fulfillment/cycle-counts/${reservedCountId}/submit`)
      .send({})
      .expect(201);
    await api('post', `/fulfillment/cycle-counts/${reservedCountId}/approve`)
      .send({})
      .expect(409);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(4);
  }, 30000);

  it('moves serial stock between floors and warehouses without duplicating identity or physical units', async () => {
    const item = await product('serial', 1);
    await api('patch', `/fulfillment/products/${item.id}/controls`)
      .send({ expiryControlled: false, serialControlled: true })
      .expect(200);
    const source = await api('post', '/fulfillment/bins')
      .send({
        warehouseId: 'MASTER',
        building: 'SER',
        floor: 'F1',
        zone: 'ZA',
        rack: 'R01',
        shelf: 'S01',
        bin: 'B01',
      })
      .expect(201);
    const destination = await api('post', '/fulfillment/bins')
      .send({
        warehouseId: 'MASTER',
        building: 'SER',
        floor: 'F2',
        zone: 'ZA',
        rack: 'R01',
        shelf: 'S01',
        bin: 'B01',
      })
      .expect(201);
    const serialNumber = `SERIAL-${suffix}`;
    await api('post', '/fulfillment/lots/register')
      .send({ productId: item.id, warehouseId: 'MASTER', quantity: 1 })
      .expect(400);
    await api('post', '/fulfillment/lots/register')
      .send({
        productId: item.id,
        warehouseId: 'MASTER',
        quantity: 2,
        serialNumber,
      })
      .expect(400);
    const registered = await api('post', '/fulfillment/lots/register')
      .send({
        productId: item.id,
        warehouseId: 'MASTER',
        binId: json(source).id,
        quantity: 1,
        serialNumber,
      })
      .expect(201);
    const lotId = json(registered).id;
    await api('post', '/fulfillment/transfers')
      .send({
        lotId,
        quantity: 1,
        destinationWarehouseId: 'MASTER',
        destinationBinId: json(destination).id,
        scan: 'WRONG',
      })
      .expect(400);
    await api('post', '/fulfillment/transfers')
      .send({
        lotId,
        quantity: 2,
        destinationWarehouseId: 'MASTER',
        destinationBinId: json(destination).id,
        scan: item.sku,
      })
      .expect(409);
    const moved = await api('post', '/fulfillment/transfers')
      .send({
        lotId,
        quantity: 1,
        destinationWarehouseId: 'MASTER',
        destinationBinId: json(destination).id,
        scan: item.sku,
      })
      .expect(201);
    expect(json(moved).id).toBe(lotId);
    expect(
      await db.warehouseLot.count({
        where: { company, productId: item.id, serialNumber },
      }),
    ).toBe(1);
    expect(
      (await db.warehouseLot.findUniqueOrThrow({ where: { id: lotId } })).binId,
    ).toBe(json(destination).id);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(1);
    const warehouse = await db.warehouse.create({
      data: {
        company,
        name: `Serial target ${suffix}`,
        address: 'Integration fixture',
      },
    });
    const targetBin = await api('post', '/fulfillment/bins')
      .send({
        warehouseId: String(warehouse.id),
        building: 'SER',
        floor: 'F3',
        zone: 'ZA',
        rack: 'R01',
        shelf: 'S01',
        bin: 'B01',
      })
      .expect(201);
    await api('post', '/fulfillment/transfers')
      .send({
        lotId,
        quantity: 1,
        destinationWarehouseId: String(warehouse.id),
        destinationBinId: json(destination).id,
        scan: item.sku,
      })
      .expect(400);
    await api('post', '/fulfillment/transfers')
      .send({
        lotId,
        quantity: 1,
        destinationWarehouseId: String(warehouse.id),
        destinationBinId: json(targetBin).id,
        scan: item.sku,
      })
      .expect(201);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: item.id } }))
        .currentStock,
    ).toBe(0);
    const hub = await db.warehouseStock.findUniqueOrThrow({
      where: {
        warehouseId_productId: {
          warehouseId: String(warehouse.id),
          productId: item.id,
        },
      },
    });
    expect(hub.quantity).toBe(1);
    expect(
      (await db.warehouseLot.findUniqueOrThrow({ where: { id: lotId } }))
        .warehouseId,
    ).toBe(String(warehouse.id));
    expect(
      await db.warehouseLot.count({
        where: { company, productId: item.id, serialNumber },
      }),
    ).toBe(1);
    const moves = await db.inventoryMovement.findMany({
      where: { company, productId: item.id, type: 'TRANSFER' },
    });
    expect(moves).toHaveLength(4);
    expect(
      moves.every(
        (movement) => movement.serialNumber === serialNumber && movement.binId,
      ),
    ).toBe(true);
  }, 30000);
});

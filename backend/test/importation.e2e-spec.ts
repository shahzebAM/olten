import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { ImportationModule } from '../src/importation/importation.module';
import { AuthSessionService } from '../src/auth/auth-session.service';
import { ProcurementController } from '../src/sales/purchase-orders.controller';

// Run only against an explicitly supplied, isolated test database. No data is reset.
describe('Phase 1 purchasing to inventory (PostgreSQL)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let token: string;
  let staffToken: string;
  let productId: number;
  let foreignProductId: number;
  let supplierId: string;
  let warehouseId: number;
  const suffix = randomUUID().slice(0, 8);
  const company = `Phase1-${suffix}`;
  const otherCompany = `Other-${suffix}`;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  beforeAll(async () => {
    const testUrl = process.env.PHASE1_TEST_DATABASE_URL;
    if (!testUrl || testUrl !== process.env.DATABASE_URL) {
      throw new Error(
        'Set PHASE1_TEST_DATABASE_URL and DATABASE_URL to the same isolated test database.',
      );
    }
    const parsed = new URL(testUrl);
    if (
      !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
      !/\/olten_phase1_test$/.test(parsed.pathname)
    ) {
      throw new Error(
        'Integration tests require the local olten_phase1_test database.',
      );
    }
    prisma = new PrismaClient();
    await prisma.company.createMany({
      data: [{ name: company }, { name: otherCompany }],
    });
    const admin = await prisma.admin.create({
      data: {
        username: `phase1-${suffix}`,
        password: randomUUID(),
        role: 'Admin',
        status: 'Active',
        modules: {
          importation: true,
          inventory: true,
          companies: { [company]: true },
        },
      },
    });
    const staff = await prisma.admin.create({
      data: {
        username: `staff-${suffix}`,
        password: randomUUID(),
        role: 'Staff',
        status: 'Active',
        modules: { importation: true, companies: { [company]: true } },
      },
    });
    for (const workspace of [company, otherCompany]) {
      const product = await prisma.product.create({
        data: {
          company: workspace,
          name: 'Integration instrument',
          sku: `TEST-${workspace}`,
          category: 'Surgical',
          purchasePrice: 10,
          sellingPrice: 20,
          unit: 'pcs',
          vatSetting: 'NONE',
        },
      });
      if (workspace === company) productId = product.id;
      else foreignProductId = product.id;
    }
    const supplier = await prisma.supplier.create({
      data: {
        company,
        legalName: 'Integration supplier',
        tin: `test-${suffix}`,
        address: 'Test address',
      },
    });
    supplierId = supplier.id;
    const warehouse = await prisma.warehouse.create({
      data: { company, name: 'Integration hub' },
    });
    warehouseId = warehouse.id;
    const module = await Test.createTestingModule({
      imports: [ImportationModule],
      controllers: [ProcurementController],
    }).compile();
    app = module.createNestApplication<INestApplication<Server>>();
    await app.init();
    token = app.get(AuthSessionService).issue(admin).accessToken;
    staffToken = app.get(AuthSessionService).issue(staff).accessToken;
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  const auth = (
    test: request.Test,
    accessToken?: string,
    workspace = company,
  ) =>
    test
      .set('Authorization', `Bearer ${accessToken ?? token}`)
      .set('x-company', workspace);
  const post = (path: string, body: object) =>
    auth(request(app.getHttpServer()).post(`/importation/${path}`)).send(body);
  const patch = (path: string, body: object) =>
    auth(request(app.getHttpServer()).patch(`/importation/${path}`)).send(body);
  type Created = {
    id: string;
    items: { id: string; unitCost: number; requestedQty: number }[];
  };

  it('requires a real session and workspace permission', async () => {
    await request(app.getHttpServer()).get('/importation/overview').expect(401);
    await auth(
      request(app.getHttpServer()).get('/importation/overview'),
      token,
      otherCompany,
    ).expect(403);
    await auth(
      request(app.getHttpServer()).get('/importation/overview'),
    ).expect(200);
  });

  it('rejects foreign products and invalid requisition quantities', async () => {
    await post('requisitions', {
      purpose: 'Foreign product',
      items: [{ productId: foreignProductId, quantity: 1 }],
    }).expect(400);
    for (const quantity of [0, -1, 1.5]) {
      await post('requisitions', {
        purpose: 'Invalid quantity',
        items: [{ productId, quantity }],
      }).expect(400);
    }
  });

  it('approves a foreign quote, handles partial shipments/QC and places accepted stock exactly once', async () => {
    const pr = (
      await post('requisitions', {
        purpose: 'Integration import',
        items: [{ productId, quantity: 10 }],
      }).expect(201)
    ).body as Created;
    const quote = (
      await post(`requisitions/${pr.id}/quotations`, {
        supplierId,
        currency: 'USD',
        exchangeRate: 56.125,
        leadTimeDays: 14,
        paymentTerms: '30 days',
        items: [
          {
            requisitionItemId: pr.items[0].id,
            unitCost: 2.333333,
            minimumOrderQty: 5,
          },
        ],
      }).expect(201)
    ).body as { id: string };
    await post(`requisitions/${pr.id}/submit`, {}).expect(201);
    await auth(
      request(app.getHttpServer()).post(
        `/importation/requisitions/${pr.id}/approve`,
      ),
      staffToken,
    )
      .send({ quotationId: quote.id })
      .expect(403);
    const approved = (
      await post(`requisitions/${pr.id}/approve`, {
        quotationId: quote.id,
      }).expect(201)
    ).body as {
      purchaseOrderId: string;
      purchaseOrder: {
        subtotal: number;
        grandTotal: number;
        vatApplied: boolean;
      };
    };
    expect(approved.purchaseOrder).toMatchObject({
      subtotal: 1309.58,
      grandTotal: 1309.58,
      vatApplied: false,
    });
    await post(`requisitions/${pr.id}/approve`, {
      quotationId: quote.id,
    }).expect(400);
    const po = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: approved.purchaseOrderId },
      include: { items: true },
    });
    expect(po.items[0].unitCost).toBe(130.958315);
    const file = (
      await post('import-files', { title: 'Integration file' }).expect(201)
    ).body as { id: string };
    const shipment = (
      await post('shipments', {
        importFileId: file.id,
        mode: 'Sea',
        eta: today,
        items: [{ purchaseOrderItemId: po.items[0].id, shippedQty: 6 }],
      }).expect(201)
    ).body as Created;
    await post('shipments', {
      importFileId: file.id,
      mode: 'Air',
      items: [{ purchaseOrderItemId: po.items[0].id, shippedQty: 5 }],
    }).expect(400);
    const consolidatedPo = await prisma.purchaseOrder.create({
      data: {
        company,
        poNumber: `TEST-PO-${suffix}`,
        status: 'Generated',
        supplierId,
        createdBy: 'Integration fixture',
        subtotal: 100,
        grandTotal: 100,
        items: {
          create: {
            productId,
            sku: po.items[0].sku,
            productName: po.items[0].productName,
            requestedQty: 2,
            unitCost: 50,
            lineTotal: 100,
          },
        },
      },
      include: { items: true },
    });
    const secondShipment = (
      await post('shipments', {
        importFileId: file.id,
        mode: 'Air',
        items: [
          { purchaseOrderItemId: po.items[0].id, shippedQty: 4 },
          { purchaseOrderItemId: consolidatedPo.items[0].id, shippedQty: 2 },
        ],
      }).expect(201)
    ).body as { id: string; items: { id: string; shippedQty: number }[] };
    await request(app.getHttpServer())
      .post(`/procurement/purchase-orders/${po.id}/receive`)
      .send({
        user: 'spoofed',
        verifications: [{ itemId: po.items[0].id, confirmedQty: 10 }],
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/procurement/purchase-orders/${po.id}/status`)
      .send({ status: 'Stocked', user: 'spoofed' })
      .expect(400);
    await patch(`shipments/${shipment.id}`, {
      status: 'Arrived',
      actualArrival: today,
    }).expect(200);
    const receiptPayload = {
      receivedAt: today,
      items: [
        {
          shipmentLineId: shipment.items[0].id,
          receivedQty: 6,
          acceptedQty: 3,
          rejectedQty: 1,
          heldQty: 2,
          batchNumber: 'BATCH-TEST',
          expirationDate: '2099-12-31',
        },
      ],
    };
    await post(`shipments/${shipment.id}/receipts`, receiptPayload).expect(400);
    await patch(`shipments/${shipment.id}/clearance`, {
      broker: 'Test broker',
      status: 'Cleared',
      clearanceDate: today,
      entryReference: 'ENTRY-TEST',
      items: [{ shipmentLineId: shipment.items[0].id, clearedQty: 6 }],
    }).expect(200);
    const receipt = (
      await post(`shipments/${shipment.id}/receipts`, receiptPayload).expect(
        201,
      )
    ).body as Created;
    expect(
      await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        include: { items: true },
      }),
    ).toMatchObject({
      status: 'Partially Received',
      items: [{ confirmedQty: 6, shortageQty: 4 }],
    });
    await post(`shipments/${shipment.id}/receipts`, receiptPayload).expect(400);
    const place = (quantity: number, destination = 'MASTER') =>
      post(`receipts/${receipt.id}/place`, {
        placements: [
          {
            receiptLineId: receipt.items[0].id,
            warehouseId: destination,
            quantity,
          },
        ],
      });
    await place(4).expect(409);
    await place(2).expect(201);
    await place(1, String(warehouseId)).expect(201);
    await place(1).expect(409);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: productId } }))
        .currentStock,
    ).toBe(2);
    expect(
      (
        await prisma.warehouseStock.findUniqueOrThrow({
          where: {
            warehouseId_productId: {
              warehouseId: String(warehouseId),
              productId,
            },
          },
        })
      ).quantity,
    ).toBe(1);
    const movements = await prisma.inventoryMovement.findMany({
      where: { company, productId },
    });
    expect(movements).toHaveLength(2);
    expect(
      movements.every((movement) => movement.batchNumber === 'BATCH-TEST'),
    ).toBe(true);
    await patch(`receipt-lines/${receipt.items[0].id}/qc`, {
      acceptedQty: 2,
      rejectedQty: 2,
      heldQty: 2,
    }).expect(400);
    await patch(`receipt-lines/${receipt.items[0].id}/qc`, {
      acceptedQty: 5,
      rejectedQty: 1,
      heldQty: 0,
    }).expect(200);
    const queue = (
      await auth(
        request(app.getHttpServer()).get('/importation/receiving-queue'),
      ).expect(200)
    ).body as {
      goodsReceiptId: string;
      items: { confirmedQty: number }[];
    }[];
    expect(
      queue.find((item) => item.goodsReceiptId === receipt.id)?.items[0]
        .confirmedQty,
    ).toBe(2);
    const concurrent = await Promise.all([place(2), place(2)]);
    expect(concurrent.map((result) => result.status).sort()).toEqual([
      201, 409,
    ]);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: productId } }))
        .currentStock,
    ).toBe(4);
    const expense = (
      await post(`shipments/${shipment.id}/expenses`, {
        category: 'Duties',
        description: 'Integration duty',
        currency: 'PHP',
        amount: 100.125,
        status: 'Estimated',
      }).expect(201)
    ).body as { id: string; amount: string };
    expect(expense.amount).toBe('100.13');
    await patch(`expenses/${expense.id}`, {
      category: 'Duties',
      description: 'Integration duty',
      currency: 'PHP',
      amount: 100.13,
      status: 'Paid',
      paidAt: today,
      invoiceReference: 'INV-TEST',
    }).expect(200);
    await patch(`shipments/${shipment.id}`, { status: 'Closed' }).expect(200);
    await patch(`shipments/${secondShipment.id}`, {
      status: 'Arrived',
      actualArrival: today,
    }).expect(200);
    await patch(`shipments/${secondShipment.id}/clearance`, {
      status: 'Cleared',
      clearanceDate: today,
      items: secondShipment.items.map((item) => ({
        shipmentLineId: item.id,
        clearedQty: item.shippedQty,
      })),
    }).expect(200);
    const secondReceipt = (
      await post(`shipments/${secondShipment.id}/receipts`, {
        receivedAt: today,
        items: secondShipment.items.map((item) => ({
          shipmentLineId: item.id,
          receivedQty: item.shippedQty,
          acceptedQty: item.shippedQty,
          rejectedQty: 0,
          heldQty: 0,
        })),
      }).expect(201)
    ).body as { id: string; items: { id: string; acceptedQty: number }[] };
    await post(`receipts/${secondReceipt.id}/place`, {
      placements: [
        {
          receiptLineId: secondReceipt.items[0].id,
          warehouseId: 'MASTER',
          quantity: secondReceipt.items[0].acceptedQty,
        },
        {
          receiptLineId: secondReceipt.items[1].id,
          warehouseId: '2147483647',
          quantity: secondReceipt.items[1].acceptedQty,
        },
      ],
    }).expect(400);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: productId } }))
        .currentStock,
    ).toBe(4);
    expect(
      (
        await prisma.goodsReceiptLine.findUniqueOrThrow({
          where: { id: secondReceipt.items[0].id },
        })
      ).placedQty,
    ).toBe(0);
    await post(`receipts/${secondReceipt.id}/place`, {
      placements: secondReceipt.items.map((item) => ({
        receiptLineId: item.id,
        warehouseId: String(warehouseId),
        quantity: item.acceptedQty,
      })),
    }).expect(201);
    expect(
      (
        await prisma.warehouseStock.findUniqueOrThrow({
          where: {
            warehouseId_productId: {
              warehouseId: String(warehouseId),
              productId,
            },
          },
        })
      ).quantity,
    ).toBe(7);
    expect(
      await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        include: { items: true },
      }),
    ).toMatchObject({
      status: 'Received',
      items: [{ confirmedQty: 10, shortageQty: 0 }],
    });
    expect(
      (
        await prisma.purchaseOrder.findUniqueOrThrow({
          where: { id: consolidatedPo.id },
        })
      ).status,
    ).toBe('Received');
  }, 30000);

  it('does not allow another workspace to place or inspect a receipt', async () => {
    const receipt = await prisma.goodsReceipt.findFirstOrThrow({
      where: { company },
      include: { items: true },
    });
    await auth(
      request(app.getHttpServer()).post(
        `/importation/receipts/${receipt.id}/place`,
      ),
      token,
      otherCompany,
    )
      .send({
        placements: [
          {
            receiptLineId: receipt.items[0].id,
            warehouseId: 'MASTER',
            quantity: 1,
          },
        ],
      })
      .expect(403);
    await post('receipts/does-not-exist/place', {
      placements: [
        {
          receiptLineId: receipt.items[0].id,
          warehouseId: 'MASTER',
          quantity: 1,
        },
      ],
    }).expect(404);
  });

  it('serializes shipment allocation against the legacy receiving path', async () => {
    const po = await prisma.purchaseOrder.create({
      data: {
        company,
        poNumber: `RACE-PO-${suffix}`,
        status: 'Generated',
        supplierId,
        createdBy: 'Integration fixture',
        subtotal: 50,
        grandTotal: 50,
        items: {
          create: {
            productId,
            sku: `TEST-${company}`,
            productName: 'Integration instrument',
            requestedQty: 5,
            unitCost: 10,
            lineTotal: 50,
          },
        },
      },
      include: { items: true },
    });
    const file = (
      await post('import-files', { title: 'Concurrent receiving test' }).expect(
        201,
      )
    ).body as { id: string };
    const results = await Promise.all([
      post('shipments', {
        importFileId: file.id,
        mode: 'Sea',
        items: [{ purchaseOrderItemId: po.items[0].id, shippedQty: 5 }],
      }),
      request(app.getHttpServer())
        .post(`/procurement/purchase-orders/${po.id}/receive`)
        .send({
          user: 'Integration fixture',
          verifications: [{ itemId: po.items[0].id, confirmedQty: 5 }],
        }),
    ]);
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(
      results.every((result) => [201, 400, 409].includes(result.status)),
    ).toBe(true);
    const refreshed = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: po.id },
      include: { items: { include: { shipmentLines: true } } },
    });
    if (refreshed.items[0].shipmentLines.length > 0) {
      expect(refreshed.status).toBe('Generated');
      expect(refreshed.items[0].confirmedQty).toBeNull();
    } else {
      expect(refreshed.status).toBe('Received');
      expect(refreshed.items[0].confirmedQty).toBe(5);
    }
  });
});

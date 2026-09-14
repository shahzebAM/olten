import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { OrderSlipsController } from '../src/sales/order-slips.controller';
import { ShortagesController } from '../src/sales/shortages.controller';
import { OrderSlipProcessingService, SHORTAGE_STATUSES } from '../src/sales/order-slip-processing.service';
import { SalesPrismaService } from '../src/sales/sales-prisma.service';

// Never run these tests against the application's default schema.
const schema = process.env.PHASE7_TEST_SCHEMA;
if (!schema || !/^phase7_test_[a-f0-9]{32}$/.test(schema) || new URL(process.env.DATABASE_URL!).searchParams.get('schema') !== schema) {
  throw new Error('Use npm run test:phase7 to create an isolated schema first.');
}

describe('Phase 7 physical verification and shortages (real PostgreSQL + HTTP)', () => {
  let app: INestApplication;
  let db: SalesPrismaService;
  const company = 'Phase7';
  const user = 'Physical verifier';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrderSlipsController, ShortagesController],
      providers: [SalesPrismaService, OrderSlipProcessingService],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(SalesPrismaService);
  });
  afterAll(async () => { await app?.close(); });

  async function fixture(count = 1, scope = company) {
    const customer = await db.customer.create({ data: { name: 'Physical count customer', company: scope } });
    const products = await Promise.all(Array.from({ length: count }, (_, index) => db.product.create({ data: {
      company: scope, sku: `P7-${randomUUID()}`, name: `Verification product ${index}`, category: 'Test', purchasePrice: 1, sellingPrice: 2, unit: 'pcs', vatSetting: 'NONE', currentStock: 73,
    } })));
    await db.warehouseStock.createMany({ data: products.flatMap(product => [
      { company: scope, productId: product.id, sku: product.sku, warehouseId: 'test-a', quantity: 30 },
      { company: scope, productId: product.id, sku: product.sku, warehouseId: 'test-b', quantity: 20 },
    ]) });
    const os = await db.orderSlip.create({ data: {
      osNumber: `P7-${randomUUID()}`, company: scope, customerId: customer.id, status: 'Generated', subtotal: 100 * count, vatAmount: 0, grandTotal: 100 * count, createdBy: user,
      items: { create: products.map(product => ({ productId: product.id, sku: product.sku, productName: product.name, requestedQty: 50, unitPrice: 2, lineTotal: 100 })) },
    }, include: { items: true } });
    return { os, products };
  }
  function payload(os: Awaited<ReturnType<typeof fixture>>['os'], quantities = os.items.map(() => 42)) {
    return { company, user, expectedUpdatedAt: os.updatedAt.toISOString(), items: os.items.map((item, index) => ({ id: item.id, physicalConfirmedQty: quantities[index] })) };
  }
  const processOS = (os: Awaited<ReturnType<typeof fixture>>['os'], data = payload(os)) => request(app.getHttpServer()).post(`/sales/order-slips/${os.id}/process`).send(data);

  it('migrates existing O.S. rows without assuming physical confirmation', async () => {
    const os = await db.orderSlip.findUniqueOrThrow({ where: { id: 'legacy-os' }, include: { items: true } });
    expect(os.status).toBe('Generated');
    expect(os.processedAt).toBeNull();
    expect(os.items[0]).toMatchObject({ requestedQty: 50, warehouseQty: null, physicalConfirmedQty: null, shortageQty: null });
  });

  it('Requested 50 / Warehouse 50 / Physical 42 => Shortage 8; never changes inventory', async () => {
    const { os, products } = await fixture();
    const before = await db.warehouseStock.findMany({ where: { productId: products[0].id }, orderBy: { id: 'asc' } });
    const review = await request(app.getHttpServer()).get(`/sales/order-slips/${os.id}/review`).query({ company }).expect(200);
    expect(review.body.items[0]).toMatchObject({ warehouseQty: 50, requestedQty: 50, physicalConfirmedQty: null, shortageQty: null });
    const result = await processOS(os).expect(201);
    expect(result.body).toMatchObject({ status: 'Processed', processedBy: user });
    expect(result.body.processedAt).toBeTruthy();
    expect(result.body.items[0]).toMatchObject({ warehouseQty: 50, requestedQty: 50, physicalConfirmedQty: 42, shortageQty: 8 });
    expect(result.body.shortages).toHaveLength(1);
    expect(result.body.shortages[0]).toMatchObject({ orderSlipId: os.id, orderSlipItemId: os.items[0].id, status: 'Open' });
    expect(await db.warehouseStock.findMany({ where: { productId: products[0].id }, orderBy: { id: 'asc' } })).toEqual(before);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).currentStock).toBe(73);
    const list = await request(app.getHttpServer()).get('/sales/shortages').query({ company, search: os.osNumber }).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].orderSlip.id).toBe(os.id);
    expect(list.body.data[0].orderSlipItem.shortageQty).toBe(8);
    await processOS(os).expect(409);
    expect(await db.shortage.count({ where: { orderSlipId: os.id } })).toBe(1);
  });

  it.each([0, 50, 60])('handles physical %i including zero and over-confirmation without negative shortage', async physical => {
    const { os } = await fixture();
    const result = await processOS(os, payload(os, [physical])).expect(201);
    expect(result.body.items[0].shortageQty).toBe(Math.max(0, 50 - physical));
    expect(result.body.shortages).toHaveLength(physical < 50 ? 1 : 0);
  });

  it.each([-1, 1.5, null, '', '42', true, 2147483648])('rejects invalid physical count %p with no partial changes', async physical => {
    const { os } = await fixture();
    const data = payload(os);
    (data.items[0] as any).physicalConfirmedQty = physical;
    await processOS(os, data).expect(400);
    expect((await db.orderSlip.findUniqueOrThrow({ where: { id: os.id } })).status).toBe('Generated');
    expect((await db.orderSlipItem.findUniqueOrThrow({ where: { id: os.items[0].id } })).physicalConfirmedQty).toBeNull();
    expect(await db.shortage.count({ where: { orderSlipId: os.id } })).toBe(0);
  });

  it('re-checks inventory at processing time and retains that snapshot in later reviews', async () => {
    const { os, products } = await fixture();
    await request(app.getHttpServer()).get(`/sales/order-slips/${os.id}/review`).query({ company }).expect(200);
    await db.warehouseStock.updateMany({ where: { productId: products[0].id, warehouseId: 'test-b' }, data: { quantity: 10 } });
    const result = await processOS(os).expect(201);
    expect(result.body.items[0]).toMatchObject({ warehouseQty: 40, physicalConfirmedQty: 42, shortageQty: 8 });
    await db.warehouseStock.updateMany({ where: { productId: products[0].id }, data: { quantity: 100 } });
    const review = await request(app.getHttpServer()).get(`/sales/order-slips/${os.id}/review`).query({ company }).expect(200);
    expect(review.body.items[0].warehouseQty).toBe(40);
  });

  it('requires all item IDs exactly once and rejects foreign IDs and stale reviews', async () => {
    const { os } = await fixture(2);
    const data = payload(os);
    await processOS(os, { ...data, items: data.items.slice(0, 1) }).expect(400);
    await processOS(os, { ...data, items: [data.items[0], data.items[0]] }).expect(400);
    await processOS(os, { ...data, items: [data.items[0], { id: 'foreign', physicalConfirmedQty: 42 }] }).expect(400);
    await processOS(os, { ...data, expectedUpdatedAt: new Date(0).toISOString() }).expect(409);
    expect(await db.shortage.count({ where: { orderSlipId: os.id } })).toBe(0);
  });

  it('isolates companies and validates inactive products and document status', async () => {
    const { os, products } = await fixture();
    await request(app.getHttpServer()).get(`/sales/order-slips/${os.id}/review`).query({ company: 'Other' }).expect(404);
    await processOS(os, { ...payload(os), company: 'Other' }).expect(404);
    await request(app.getHttpServer()).get('/sales/shortages').expect(400);
    await db.product.update({ where: { id: products[0].id }, data: { isActive: false } });
    await processOS(os).expect(400);
    await db.product.update({ where: { id: products[0].id }, data: { isActive: true } });
    await db.orderSlip.update({ where: { id: os.id }, data: { status: 'Cancelled' } });
    await processOS(os).expect(409);
  });

  it('rolls back item writes, shortage inserts, and status if a later database write fails', async () => {
    const { os } = await fixture(2);
    const blocked = os.items[1].id;
    // A real database constraint fails the second line after the first was saved.
    await db.$executeRawUnsafe(`ALTER TABLE "OrderSlipItem" ADD CONSTRAINT phase7_forced_failure CHECK ("id" <> '${blocked}' OR "physicalConfirmedQty" IS NULL)`);
    try {
      await processOS(os).expect(500);
      const stored = await db.orderSlip.findUniqueOrThrow({ where: { id: os.id }, include: { items: true } });
      expect(stored.status).toBe('Generated');
      expect(stored.processedAt).toBeNull();
      expect(stored.items.every(item => item.physicalConfirmedQty === null && item.shortageQty === null && item.warehouseQty === null)).toBe(true);
      expect(await db.shortage.count({ where: { orderSlipId: os.id } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "OrderSlipItem" DROP CONSTRAINT phase7_forced_failure');
    }
  });

  it('concurrent processing creates exactly one verification and one shortage per line', async () => {
    const { os } = await fixture();
    const responses = await Promise.all([processOS(os), processOS(os)]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await db.shortage.count({ where: { orderSlipId: os.id } })).toBe(1);
  });

  it('preserves references against edits, deletion and status bypass; cancellation closes outstanding shortages', async () => {
    const { os } = await fixture();
    await request(app.getHttpServer()).patch(`/sales/order-slips/${os.id}`).send({ status: 'Processed', user }).expect(400);
    await request(app.getHttpServer()).patch(`/sales/order-slips/${os.id}`).send({ status: 'Shipped', user }).expect(400);
    const result = await processOS(os).expect(201);
    await request(app.getHttpServer()).patch(`/sales/order-slips/${os.id}`).send({ items: [], user }).expect(400);
    await request(app.getHttpServer()).delete(`/sales/order-slips/${os.id}`).expect(400);
    await request(app.getHttpServer()).patch(`/sales/order-slips/${os.id}`).send({ status: 'Generated', user }).expect(400);
    await request(app.getHttpServer()).patch(`/sales/order-slips/${os.id}`).send({ status: 'Shipped', user }).expect(200);
    await request(app.getHttpServer()).delete(`/sales/order-slips/${os.id}/cancel`).send({ user }).expect(200);
    const shortage = await db.shortage.findUniqueOrThrow({ where: { id: result.body.shortages[0].id } });
    expect(shortage.status).toBe('Cancelled');
    expect(shortage.orderSlipId).toBe(os.id);
    await request(app.getHttpServer()).patch(`/sales/shortages/${shortage.id}/status`).send({ company, status: 'Open', user, expectedUpdatedAt: shortage.updatedAt.toISOString() }).expect(409);
  });

  it('supports all shortage statuses, filtering, company scoping, and stale status protection', async () => {
    const { os } = await fixture();
    const result = await processOS(os).expect(201);
    let shortage = result.body.shortages[0];
    const initialRevision = shortage.updatedAt;
    for (const status of SHORTAGE_STATUSES) {
      const response = await request(app.getHttpServer()).patch(`/sales/shortages/${shortage.id}/status`).send({ company, user, status, expectedUpdatedAt: shortage.updatedAt }).expect(200);
      shortage = response.body;
      expect(shortage.status).toBe(status);
      const list = await request(app.getHttpServer()).get('/sales/shortages').query({ company, status, search: os.osNumber }).expect(200);
      expect(list.body.total).toBe(1);
    }
    await request(app.getHttpServer()).patch(`/sales/shortages/${shortage.id}/status`).send({ company, user, status: 'Open', expectedUpdatedAt: initialRevision }).expect(409);
    await request(app.getHttpServer()).patch(`/sales/shortages/${shortage.id}/status`).send({ company, user, status: 'Invalid', expectedUpdatedAt: shortage.updatedAt }).expect(400);
    await request(app.getHttpServer()).patch(`/sales/shortages/${shortage.id}/status`).send({ company: 'Other', user, status: 'Open', expectedUpdatedAt: shortage.updatedAt }).expect(404);
    const other = await request(app.getHttpServer()).get('/sales/shortages').query({ company: 'Other', search: os.osNumber }).expect(200);
    expect(other.body.total).toBe(0);
  });
});

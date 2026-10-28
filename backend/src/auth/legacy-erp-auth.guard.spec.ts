import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MasterInventoryController } from '../master-inventory/master-inventory.controller';
import { SalesController } from '../sales/sales.controller';
import { ProcurementController } from '../sales/purchase-orders.controller';
import { OrderSlipsController } from '../sales/order-slips.controller';
import { QuotationsController } from '../sales/quotations.controller';
import { PackingListsController } from '../sales/packing-lists.controller';
import {
  LegacyCompanyRecord,
  LegacyErpAccess,
  LegacyErpAuthGuard,
  LegacyReadModules,
} from './legacy-erp-auth.guard';

function mockDatabase() {
  return Object.fromEntries(
    [
      'product',
      'warehouse',
      'employee',
      'customer',
      'supplier',
      'customerCategory',
      'orderSlip',
      'packingList',
      'shortage',
      'purchaseOrder',
    ].map((model) => [
      model,
      { findMany: jest.fn().mockResolvedValue([{ company: 'Audit' }]) },
    ]),
  ) as Record<string, { findMany: jest.Mock }>;
}
jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  return { ...actual, PrismaClient: jest.fn() };
});

@LegacyErpAccess('sales')
class SalesFixture {
  list() {}
  write() {}
  @LegacyCompanyRecord('customer')
  customer() {}
  @LegacyCompanyRecord('orderSlip')
  orderSlip() {}
  @LegacyCompanyRecord('packingList')
  packingList() {}
  @LegacyCompanyRecord('shortage')
  shortage() {}
  @LegacyCompanyRecord('customerCategory')
  category() {}
}
@LegacyErpAccess('purchasing')
class PurchasingFixture {
  @LegacyCompanyRecord('purchaseOrder')
  order() {}
  @LegacyCompanyRecord('supplier')
  supplier() {}
  write() {}
}
@LegacyErpAccess('inventory')
class InventoryFixture {
  @LegacyReadModules('sales')
  list() {}
  @LegacyReadModules('sales')
  write() {}
  @LegacyCompanyRecord('product')
  product() {}
  @LegacyCompanyRecord('warehouse')
  warehouse() {}
  @LegacyCompanyRecord('employee')
  employee() {}
}
@LegacyErpAccess('qr')
class QrFixture {
  list() {}
}
class NoScopeFixture {
  list() {}
}

type RequestFixture = {
  method: string;
  headers: Record<string, unknown>;
  query: Record<string, unknown>;
  params: Record<string, string>;
  body: unknown;
};
type Controller = { prototype: object };
const request = (patch: Partial<RequestFixture> = {}): RequestFixture => ({
  method: 'GET',
  headers: { authorization: 'Bearer verified', 'x-company': 'Audit' },
  query: { company: 'Audit' },
  params: {},
  body: {},
  ...patch,
});
function contextFor(
  input: RequestFixture,
  controller: Controller = SalesFixture,
  method = 'list',
) {
  return {
    switchToHttp: () => ({ getRequest: () => input }),
    getClass: () => controller,
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
  } as unknown as ExecutionContext;
}
const user = (
  modules: unknown = {
    sales: true,
    purchasing: true,
    inventory: true,
    companies: { Audit: true },
  },
  role = 'Admin',
) => ({ id: 1, username: 'verified-user', role, modules });

describe('Legacy ERP authenticated company and module boundaries', () => {
  const sessions = { authenticate: jest.fn(), companyExists: jest.fn() };
  let guard: LegacyErpAuthGuard;
  let db: ReturnType<typeof mockDatabase>;
  beforeEach(() => {
    jest.resetAllMocks();
    db = mockDatabase();
    sessions.authenticate.mockImplementation((authorization: unknown) => {
      if (authorization !== 'Bearer verified')
        throw new UnauthorizedException();
      return Promise.resolve(user());
    });
    sessions.companyExists.mockResolvedValue(true);
    guard = Object.create(LegacyErpAuthGuard.prototype) as LegacyErpAuthGuard;
    Object.defineProperties(guard, {
      sessions: { value: sessions },
      reflector: { value: new Reflector() },
      prisma: { value: db },
    });
  });

  it.each([
    [MasterInventoryController, 'inventory'],
    [SalesController, 'sales'],
    [ProcurementController, 'purchasing'],
    [OrderSlipsController, 'sales'],
    [QuotationsController, 'sales'],
    [PackingListsController, 'sales'],
  ] as const)(
    'wires the actual %p controller to the guard and correct module scope',
    (controller, scope) => {
      const reflector = new Reflector();
      const guards = reflector.get<unknown[]>(GUARDS_METADATA, controller);
      expect(guards).toContain(LegacyErpAuthGuard);
      expect(reflector.get('legacy-erp-access', controller)).toBe(scope);
    },
  );

  it.each([
    undefined,
    '',
    'Basic unsafe',
    'Bearer malformed',
    ['Bearer verified'],
  ])(
    'requires a verified bearer session before workspace lookup: %s',
    async (authorization) => {
      await expect(
        guard.canActivate(
          contextFor(
            request({ headers: { authorization, 'x-company': 'Audit' } }),
          ),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessions.companyExists).not.toHaveBeenCalled();
      expect(sessions.authenticate).toHaveBeenCalledWith(authorization);
    },
  );

  it.each(['headers', 'query', 'body'] as const)(
    'rejects malformed workspace values in %s',
    async (location) => {
      for (const value of [
        null,
        [],
        {},
        false,
        1,
        '',
        '   ',
        'a'.repeat(101),
      ]) {
        const input = request();
        if (location === 'headers') input.headers['x-company'] = value;
        else if (location === 'query') input.query.company = value;
        else input.body = { company: value };
        await expect(
          guard.canActivate(contextFor(input)),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(sessions.companyExists).not.toHaveBeenCalled();
    },
  );

  it('rejects all omitted workspace identifiers before database access', async () => {
    await expect(
      guard.canActivate(
        contextFor(
          request({ headers: { authorization: 'Bearer verified' }, query: {} }),
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sessions.companyExists).not.toHaveBeenCalled();
  });

  it.each(['query', 'body', 'params'] as const)(
    'rejects a mismatched %s company instead of trusting the header',
    async (location) => {
      const input = request();
      if (location === 'body') input.body = { company: 'Other' };
      else input[location].company = 'Other';
      await expect(guard.canActivate(contextFor(input))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(sessions.companyExists).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    [],
    null,
    { sales: true, companies: [] },
    { sales: true, companies: { Audit: 'true' } },
    { sales: false, companies: { Audit: true } },
    { sales: true, companies: { Other: true } },
  ])(
    'fails closed for malformed, removed or foreign permissions: %j',
    async (modules) => {
      sessions.authenticate.mockResolvedValue(user(modules));
      await expect(
        guard.canActivate(contextFor(request())),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('requires the selected company to exist even for a Super Admin', async () => {
    sessions.authenticate.mockResolvedValue(user({}, 'Super Admin'));
    await expect(guard.canActivate(contextFor(request()))).resolves.toBe(true);
    sessions.companyExists.mockResolvedValue(false);
    await expect(
      guard.canActivate(contextFor(request())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not let an authenticated GET become an unscoped legacy list', async () => {
    await expect(
      guard.canActivate(contextFor(request({ query: {} }))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails closed when record metadata is present but the record ID is absent', async () => {
    await expect(
      guard.canActivate(
        contextFor(request({ query: {} }), SalesFixture, 'customer'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes an authenticated header and prevents whitespace company writes', async () => {
    const input = request({
      method: 'POST',
      headers: { authorization: 'Bearer verified', 'x-company': ' Audit ' },
      query: {},
      body: { company: ' Audit ', user: 'spoofed', username: 'spoofed' },
    });
    await expect(
      guard.canActivate(contextFor(input, SalesFixture, 'write')),
    ).resolves.toBe(true);
    expect(input.headers['x-company']).toBe('Audit');
    expect(input.body).toEqual({
      company: 'Audit',
      user: 'verified-user',
      username: 'verified-user',
    });
  });

  it.each([
    'products',
    'inventory',
    'master_inventory',
    'warehouse',
    'warehouses',
  ])('preserves existing %s inventory module access', async (module) => {
    sessions.authenticate.mockResolvedValue(
      user({ [module]: true, companies: { Audit: true } }),
    );
    await expect(
      guard.canActivate(contextFor(request(), InventoryFixture)),
    ).resolves.toBe(true);
  });

  it('allows a marked read dependency without granting inventory writes', async () => {
    sessions.authenticate.mockResolvedValue(
      user({ sales: true, companies: { Audit: true } }),
    );
    await expect(
      guard.canActivate(contextFor(request(), InventoryFixture)),
    ).resolves.toBe(true);
    for (const method of ['POST', 'PATCH', 'DELETE'])
      await expect(
        guard.canActivate(
          contextFor(
            request({ method, body: { company: 'Audit' } }),
            InventoryFixture,
            'write',
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('preserves inventory tier-price updates without granting customer writes', async () => {
    sessions.authenticate.mockResolvedValue(
      user({ inventory: true, companies: { Audit: true } }),
    );
    const input = request({
      method: 'POST',
      query: {},
      body: { company: 'Audit', prices: [] },
    });
    await expect(
      guard.canActivate(
        contextFor(input, SalesController, 'updateCategoryPrices'),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor(input, SalesController, 'createCustomer')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('preserves inventory placement status updates without granting PO creation', async () => {
    sessions.authenticate.mockResolvedValue(
      user({ inventory: true, companies: { Audit: true } }),
    );
    const input = request({
      method: 'PATCH',
      query: {},
      params: { id: 'po-1' },
      body: { status: 'Stocked' },
    });
    await expect(
      guard.canActivate(
        contextFor(input, ProcurementController, 'updatePurchaseOrderStatus'),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        contextFor(
          request({ method: 'POST', query: {} }),
          ProcurementController,
          'createPurchaseOrder',
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not give ordinary users a route with missing scope metadata', async () => {
    await expect(
      guard.canActivate(contextFor(request(), NoScopeFixture)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('preserves sales-scoped QR lookup without granting purchasing access', async () => {
    sessions.authenticate.mockResolvedValue(
      user({ sales: true, companies: { Audit: true } }),
    );
    await expect(
      guard.canActivate(contextFor(request(), QrFixture)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        contextFor(request({ method: 'POST' }), PurchasingFixture, 'write'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['customer', SalesFixture, 'customer', 'customer-id'],
    ['orderSlip', SalesFixture, 'orderSlip', 'order-id'],
    ['packingList', SalesFixture, 'packingList', 'packing-id'],
    ['shortage', SalesFixture, 'shortage', 'shortage-id'],
    ['customerCategory', SalesFixture, 'category', 'category-id'],
    ['purchaseOrder', PurchasingFixture, 'order', 'po-id'],
    ['supplier', PurchasingFixture, 'supplier', 'supplier-id'],
    ['product', InventoryFixture, 'product', '12'],
    ['warehouse', InventoryFixture, 'warehouse', '9'],
    ['employee', InventoryFixture, 'employee', '3'],
  ] as const)(
    'requires %s path records to belong to this workspace',
    async (model, controller, method, id) => {
      await expect(
        guard.canActivate(
          contextFor(
            request({ method: 'PATCH', params: { id }, query: {} }),
            controller,
            method,
          ),
        ),
      ).resolves.toBe(true);
      db[model].findMany.mockResolvedValue([{ company: 'Other' }]);
      await expect(
        guard.canActivate(
          contextFor(
            request({ method: 'PATCH', params: { id }, query: {} }),
            controller,
            method,
          ),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      db[model].findMany.mockResolvedValue([]);
      await expect(
        guard.canActivate(
          contextFor(
            request({ method: 'DELETE', params: { id }, query: {} }),
            controller,
            method,
          ),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it.each(['0', '-1', '1.5', 'NaN', '9007199254740992'])(
    'rejects invalid numeric path references: %s',
    async (id) => {
      await expect(
        guard.canActivate(
          contextFor(
            request({ method: 'PATCH', params: { id } }),
            InventoryFixture,
            'product',
          ),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each([
    ['product', { productId: 12 }],
    ['warehouse', { warehouseId: '9' }],
    ['customer', { customerId: 'foreign-customer' }],
    ['supplier', { supplierId: 'foreign-supplier' }],
    ['employee', { employeeId: 3 }],
  ] as const)(
    'rejects a foreign existing %s referenced by the body',
    async (model, reference) => {
      db[model].findMany.mockResolvedValue([{ company: 'Other' }]);
      await expect(
        guard.canActivate(
          contextFor(
            request({
              method: 'POST',
              body: { company: 'Audit', ...reference },
            }),
            PurchasingFixture,
            'write',
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it.each(['items', 'prices', 'catalog'])(
    'checks foreign product references nested inside %s',
    async (field) => {
      db.product.findMany.mockResolvedValue([{ company: 'Other' }]);
      await expect(
        guard.canActivate(
          contextFor(
            request({
              method: 'POST',
              body: { company: 'Audit', [field]: [{ productId: 8 }] },
            }),
            PurchasingFixture,
            'write',
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('checks QR/bulk product ID arrays and rejects malformed reference objects', async () => {
    db.product.findMany.mockResolvedValue([{ company: 'Other' }]);
    await expect(
      guard.canActivate(
        contextFor(
          request({
            method: 'POST',
            body: { company: 'Audit', productIds: [8, 9] },
          }),
          InventoryFixture,
          'write',
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        contextFor(
          request({
            method: 'POST',
            body: { company: 'Audit', items: [{ productId: {} }] },
          }),
          PurchasingFixture,
          'write',
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves absent ad-hoc PO product IDs while checking existing IDs and master-stock references', async () => {
    db.product.findMany.mockResolvedValue([]);
    const input = request({
      method: 'POST',
      body: {
        company: 'Audit',
        user: 'spoofed',
        items: [{ productId: 990001 }],
        warehouseId: 'MASTER',
      },
    });
    await expect(
      guard.canActivate(contextFor(input, PurchasingFixture, 'write')),
    ).resolves.toBe(true);
    expect(db.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: [990001] } },
      select: { company: true },
    });
    expect(db.warehouse.findMany).not.toHaveBeenCalled();
    expect(input.body).toMatchObject({ user: 'verified-user' });
  });
});

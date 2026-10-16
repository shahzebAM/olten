import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthSessionService } from '../auth/auth-session.service';
import {
  FulfillmentAccess,
  FulfillmentAuthGuard,
  type FulfillmentScope,
} from './fulfillment-auth.guard';

describe('fulfillment verified session and workspace guard', () => {
  const sessions = { authenticate: jest.fn(), companyExists: jest.fn() };
  const guard = new FulfillmentAuthGuard(
    sessions as unknown as AuthSessionService,
  );
  const context = (
    request: object,
    scope?: FulfillmentScope,
    classScope?: FulfillmentScope,
  ) => {
    class TestController {}
    const handler = () => undefined;
    if (scope) FulfillmentAccess(scope)(handler);
    if (classScope) FulfillmentAccess(classScope)(TestController);
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => TestController,
    } as unknown as ExecutionContext;
  };
  beforeEach(() => {
    jest.resetAllMocks();
    sessions.authenticate.mockResolvedValue({
      username: 'staff',
      role: 'Staff',
      modules: { inventory: true, companies: { Surgicom: true } },
    });
    sessions.companyExists.mockResolvedValue(true);
  });
  it.each([
    'inventory',
    'master_inventory',
    'sales',
    'warehouse',
    'warehouses',
    'delivery',
  ])(
    'accepts %s access only within an authorized workspace',
    async (permission) => {
      sessions.authenticate.mockResolvedValue({
        username: 'staff',
        role: 'Staff',
        modules: { [permission]: true, companies: { Surgicom: true } },
      });
      const request: {
        headers: Record<string, unknown>;
        user?: { username: string };
      } = {
        headers: { authorization: 'Bearer token', 'x-company': ' Surgicom ' },
      };
      await expect(guard.canActivate(context(request))).resolves.toBe(true);
      expect(request.headers['x-company']).toBe('Surgicom');
      expect(request.user?.username).toBe('staff');
    },
  );
  it('rejects missing/expired sessions before looking at company headers', async () => {
    sessions.authenticate.mockRejectedValue(new UnauthorizedException());
    await expect(
      guard.canActivate(context({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.companyExists).not.toHaveBeenCalled();
  });
  it.each([
    ['warehouse', 'inventory', true],
    ['warehouse', 'sales', false],
    ['warehouse', 'delivery', false],
    ['sales', 'inventory', false],
    ['sales', 'sales', true],
    ['sales', 'delivery', false],
    ['delivery', 'inventory', true],
    ['delivery', 'sales', true],
    ['delivery', 'delivery', true],
  ] as const)(
    'enforces %s operations for a %s-only user (allowed=%s)',
    async (scope, permission, allowed) => {
      sessions.authenticate.mockResolvedValue({
        username: 'staff',
        role: 'Staff',
        modules: { [permission]: true, companies: { Surgicom: true } },
      });
      const result = guard.canActivate(
        context({ headers: { 'x-company': 'Surgicom' } }, scope),
      );
      if (allowed) await expect(result).resolves.toBe(true);
      else await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it('applies class scope and lets a method explicitly override it', async () => {
    sessions.authenticate.mockResolvedValue({
      username: 'staff',
      role: 'Staff',
      modules: { sales: true, companies: { Surgicom: true } },
    });
    await expect(
      guard.canActivate(
        context(
          { headers: { 'x-company': 'Surgicom' } },
          undefined,
          'warehouse',
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        context(
          { headers: { 'x-company': 'Surgicom' } },
          'delivery',
          'warehouse',
        ),
      ),
    ).resolves.toBe(true);
  });
  it.each([undefined, '', ['Surgicom'], 'a'.repeat(101)])(
    'rejects invalid company %s',
    async (company) =>
      await expect(
        guard.canActivate(context({ headers: { 'x-company': company } })),
      ).rejects.toBeInstanceOf(BadRequestException),
  );
  it('rejects foreign workspace even for administrator role without company access', async () =>
    await expect(
      guard.canActivate(context({ headers: { 'x-company': 'Other' } })),
    ).rejects.toBeInstanceOf(ForbiddenException));
  it('requires module permission as well as company access', async () => {
    sessions.authenticate.mockResolvedValue({
      username: 'staff',
      role: 'Staff',
      modules: { companies: { Surgicom: true } },
    });
    await expect(
      guard.canActivate(context({ headers: { 'x-company': 'Surgicom' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('permits Super Admin only when the workspace actually exists', async () => {
    sessions.authenticate.mockResolvedValue({
      username: 'super',
      role: 'Super Admin',
      modules: {},
    });
    await expect(
      guard.canActivate(context({ headers: { 'x-company': 'Surgicom' } })),
    ).resolves.toBe(true);
    sessions.companyExists.mockResolvedValue(false);
    await expect(
      guard.canActivate(context({ headers: { 'x-company': 'Missing' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

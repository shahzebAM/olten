import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { AuthSessionService } from '../auth/auth-session.service';
import {
  Phase3Access,
  Phase3AuthGuard,
  Phase3ReadOnly,
} from './phase3-auth.guard';
import type { Phase3Scope } from './phase3.shared';

describe('Phase 3 authenticated workspace guard', () => {
  const sessions = { authenticate: jest.fn(), companyExists: jest.fn() };
  const guard = new Phase3AuthGuard(sessions as unknown as AuthSessionService);
  const user = {
    id: 1,
    username: 'finance',
    role: 'Admin',
    modules: {
      erpRoles: ['Finance'],
      books: true,
      companies: { Surgicom: true },
    },
  };
  function context(
    request: object,
    scopes: Phase3Scope[] = ['books'],
    readOnly = false,
  ) {
    class TestController {}
    const handler = () => undefined;
    Phase3Access(...scopes)(handler);
    if (readOnly) Phase3ReadOnly()(handler);
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => TestController,
    } as unknown as ExecutionContext;
  }
  beforeEach(() => {
    jest.resetAllMocks();
    sessions.authenticate.mockResolvedValue(user);
    sessions.companyExists.mockResolvedValue(true);
  });
  it('normalizes an authorized existing workspace and takes identity from the session', async () => {
    const request = {
      method: 'GET',
      headers: { authorization: 'Bearer token', 'x-company': ' Surgicom ' },
      user: undefined,
    };
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.headers['x-company']).toBe('Surgicom');
    expect(request.user).toBe(user);
  });
  it('supports OR scopes without giving Finance permissions to an Importation user', async () => {
    sessions.authenticate.mockResolvedValue({
      ...user,
      modules: {
        erpRoles: ['Importation'],
        importation: true,
        companies: { Surgicom: true },
      },
    });
    await expect(
      guard.canActivate(
        context({ method: 'GET', headers: { 'x-company': 'Surgicom' } }, [
          'finance',
          'landed',
        ]),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        context({ method: 'POST', headers: { 'x-company': 'Surgicom' } }, [
          'finance',
        ]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each([undefined, '', ['Surgicom'], 'x'.repeat(101)])(
    'rejects invalid company header %s',
    async (company) => {
      await expect(
        guard.canActivate(
          context({ method: 'GET', headers: { 'x-company': company } }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it('rejects unauthorized and missing workspaces, including nonexistent workspaces for Super Admin', async () => {
    await expect(
      guard.canActivate(
        context({ method: 'GET', headers: { 'x-company': 'Other' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    sessions.authenticate.mockResolvedValue({
      ...user,
      role: 'Super Admin',
      modules: {},
    });
    sessions.companyExists.mockResolvedValue(false);
    await expect(
      guard.canActivate(
        context({ method: 'GET', headers: { 'x-company': 'Missing' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows an Auditor read-only AI POST while rejecting financial writes', async () => {
    sessions.authenticate.mockResolvedValue({
      ...user,
      modules: {
        erpRoles: ['Auditor'],
        ai_assistant: true,
        books: true,
        companies: { Surgicom: true },
      },
    });
    await expect(
      guard.canActivate(
        context(
          { method: 'POST', headers: { 'x-company': 'Surgicom' } },
          ['ai'],
          true,
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        context({ method: 'POST', headers: { 'x-company': 'Surgicom' } }, [
          'books',
        ]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

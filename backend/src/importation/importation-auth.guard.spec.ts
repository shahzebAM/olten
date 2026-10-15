import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthSessionService } from '../auth/auth-session.service';
import { ImportationAuthGuard } from './importation-auth.guard';

describe('ImportationAuthGuard', () => {
  const identity = {
    id: 1,
    username: 'buyer',
    role: 'Purchasing',
    modules: { importation: true, companies: { Surgicom: true } },
  };
  const sessions = { authenticate: jest.fn(), companyExists: jest.fn() };
  const guard = new ImportationAuthGuard(
    sessions as unknown as AuthSessionService,
  );
  const request = {
    headers: { authorization: 'Bearer trusted', 'x-company': ' Surgicom ' },
    importationUser: undefined as unknown,
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;

  beforeEach(() => {
    jest.resetAllMocks();
    request.headers['x-company'] = ' Surgicom ';
    sessions.authenticate.mockResolvedValue(identity);
    sessions.companyExists.mockResolvedValue(true);
  });

  it('binds the authenticated user and normalized workspace', async () => {
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessions.authenticate).toHaveBeenCalledWith('Bearer trusted');
    expect(request.importationUser).toEqual(identity);
    expect(request.headers['x-company']).toBe('Surgicom');
  });

  it.each([
    { importation: false, companies: { Surgicom: true } },
    { importation: true, companies: { Other: true } },
    null,
  ])('rejects missing module/company permission %p', async (modules) => {
    sessions.authenticate.mockResolvedValue({ ...identity, modules });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects unavailable workspaces even for Super Admin', async () => {
    sessions.authenticate.mockResolvedValue({
      ...identity,
      role: 'Super Admin',
      modules: null,
    });
    sessions.companyExists.mockResolvedValue(false);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects empty company headers', async () => {
    request.headers['x-company'] = '';
    await expect(guard.canActivate(context)).rejects.toThrow(/company header/);
  });
});

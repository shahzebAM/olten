import { BadRequestException, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthSessionService } from './auth-session.service';
import { DocsAuthGuard } from './docs-auth.guard';
import { AdminAuthGuard } from './admin-auth.guard';
import { CompanyAuthGuard } from './company-auth.guard';

describe('authenticated request guards', () => {
  const sessions = { authenticate: jest.fn(), companyExists: jest.fn() };
  const user = { id: 7, username: 'actual-user', role: 'Admin', modules: { ai_docs: true, companies: { Surgicom: true } } };
  const contextFor = (request: object) => ({ switchToHttp: () => ({ getRequest: () => request }), getHandler: () => () => {} }) as unknown as ExecutionContext;
  const docs = new DocsAuthGuard(sessions as unknown as AuthSessionService);
  beforeEach(() => {
    jest.clearAllMocks();
    sessions.authenticate.mockResolvedValue(user);
    sessions.companyExists.mockResolvedValue(true);
  });

  it('rejects documents requests without a verified session', async () => {
    sessions.authenticate.mockRejectedValueOnce(new UnauthorizedException());
    await expect(docs.canActivate(contextFor({ headers: { 'x-company': 'Surgicom' } }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.companyExists).not.toHaveBeenCalled();
  });

  it('permits authorized workspaces and replaces spoofed usernames with the session identity', async () => {
    const request = { headers: { authorization: 'Bearer token', 'x-company': ' Surgicom ', 'x-username': 'spoofed-admin' } };
    await expect(docs.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.headers['x-company']).toBe('Surgicom');
    expect(request.headers['x-username']).toBe('actual-user');
    expect(sessions.companyExists).toHaveBeenCalledWith('Surgicom');
  });

  it.each([undefined, '', ['Surgicom'], 'x'.repeat(101)])('rejects an invalid company header', async company => {
    await expect(docs.canActivate(contextFor({ headers: { 'x-company': company } }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects another company even when a request supplies its name', async () => {
    await expect(docs.canActivate(contextFor({ headers: { 'x-company': 'Olten' } }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects removed document permission immediately', async () => {
    sessions.authenticate.mockResolvedValueOnce({ ...user, modules: { ai_docs: false, companies: { Surgicom: true } } });
    await expect(docs.canActivate(contextFor({ headers: { 'x-company': 'Surgicom' } }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a real workspace for Super Admin access', async () => {
    sessions.authenticate.mockResolvedValue({ ...user, role: 'Super Admin', modules: {} });
    await expect(docs.canActivate(contextFor({ headers: { 'x-company': 'Surgicom' } }))).resolves.toBe(true);
    sessions.companyExists.mockResolvedValueOnce(false);
    await expect(docs.canActivate(contextFor({ headers: { 'x-company': 'Missing' } }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('admin and company management', () => {
    const reflector = { get: jest.fn().mockReturnValue(false) };
    const admins = new AdminAuthGuard(sessions as unknown as AuthSessionService, reflector as unknown as Reflector);
    const companies = new CompanyAuthGuard(sessions as unknown as AuthSessionService);

    it('allows marked public login/setup/health handlers without a token', async () => {
      reflector.get.mockReturnValueOnce(true);
      await expect(admins.canActivate(contextFor({ headers: {}, method: 'POST', path: '/auth/login' }))).resolves.toBe(true);
      expect(sessions.authenticate).not.toHaveBeenCalled();
    });

    it('allows current user status/preferences while rejecting updates to another user', async () => {
      for (const path of ['/admins/7/status', '/api/admins/7/preferences', '/admins/actual-user/preferences']) {
        await expect(admins.canActivate(contextFor({ headers: {}, method: 'PATCH', path }))).resolves.toBe(true);
      }
      await expect(admins.canActivate(contextFor({ headers: {}, method: 'PATCH', path: '/admins/8/status' }))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects password resets, role changes and user creation by ordinary users', async () => {
      for (const path of ['/admins/7/password', '/admins/7/role', '/admins']) {
        await expect(admins.canActivate(contextFor({ headers: {}, method: 'PATCH', path }))).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it('permits Super Admin management but requires authentication for read routes', async () => {
      sessions.authenticate.mockResolvedValueOnce({ ...user, role: 'Super Admin' });
      await expect(admins.canActivate(contextFor({ headers: {}, method: 'DELETE', path: '/admins/8' }))).resolves.toBe(true);
      sessions.authenticate.mockRejectedValueOnce(new UnauthorizedException());
      await expect(admins.canActivate(contextFor({ headers: {}, method: 'GET', path: '/admins' }))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('blocks ordinary-user company mutations and allows authenticated reads', async () => {
      await expect(companies.canActivate(contextFor({ headers: {}, method: 'GET' }))).resolves.toBe(true);
      await expect(companies.canActivate(contextFor({ headers: {}, method: 'DELETE' }))).rejects.toBeInstanceOf(ForbiddenException);
      sessions.authenticate.mockResolvedValueOnce({ ...user, role: 'Super Admin' });
      await expect(companies.canActivate(contextFor({ headers: {}, method: 'POST' }))).resolves.toBe(true);
    });
  });
});

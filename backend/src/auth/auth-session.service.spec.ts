import { Logger, UnauthorizedException } from '@nestjs/common';
import { AuthSessionService, SessionAdmin } from './auth-session.service';

const mockPrisma = {
  admin: { findUnique: jest.fn() },
  company: { findUnique: jest.fn() },
  $disconnect: jest.fn().mockResolvedValue(undefined),
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));

describe('AuthSessionService', () => {
  const previousSecret = process.env.SESSION_SECRET;
  const admin: SessionAdmin = { id: 42, username: 'employee', password: 'stored-password-hash', role: 'Admin', status: 'Active', modules: { ai_docs: true, companies: { Surgicom: true } } };
  let service: AuthSessionService;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-bytes';
    jest.clearAllMocks();
    mockPrisma.admin.findUnique.mockResolvedValue(admin);
    service = new AuthSessionService();
  });
  afterEach(() => { jest.restoreAllMocks(); });
  afterAll(() => {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  });

  it('issues an eight-hour signed session without exposing password or permission claims', async () => {
    const session = service.issue(admin);
    const claims = JSON.parse(Buffer.from(session.accessToken.split('.')[1], 'base64url').toString());
    expect(claims.exp - claims.iat).toBe(8 * 60 * 60);
    expect(claims.password).toBeUndefined();
    expect(claims.modules).toBeUndefined();
    await expect(service.authenticate(`Bearer ${session.accessToken}`)).resolves.toEqual({ id: admin.id, username: admin.username, role: admin.role, status: 'Active', modules: admin.modules });
  });

  it.each([undefined, '', 'Basic abc', 'Bearer malformed', `Bearer ${'x'.repeat(5000)}`])('rejects malformed or missing authorization', async authorization => {
    await expect(service.authenticate(authorization)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockPrisma.admin.findUnique).not.toHaveBeenCalled();
  });

  it('rejects altered user identity even when the rest of the token is preserved', async () => {
    const parts = service.issue(admin).accessToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: 1 })).toString('base64url');
    await expect(service.authenticate(`Bearer ${parts.join('.')}`)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockPrisma.admin.findUnique).not.toHaveBeenCalled();
  });

  it('rejects unsigned or substituted algorithm headers', async () => {
    const parts = service.issue(admin).accessToken.split('.');
    parts[0] = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    await expect(service.authenticate(`Bearer ${parts.join('.')}`)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired token before reading the database', async () => {
    const session = service.issue(admin);
    jest.spyOn(Date, 'now').mockReturnValue(session.expiresAt * 1000);
    await expect(service.authenticate(`Bearer ${session.accessToken}`)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockPrisma.admin.findUnique).not.toHaveBeenCalled();
  });

  it('revokes sessions after password changes or user deletion', async () => {
    const token = service.issue(admin).accessToken;
    mockPrisma.admin.findUnique.mockResolvedValueOnce({ ...admin, password: 'new-password-hash' });
    await expect(service.authenticate(`Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedException);
    mockPrisma.admin.findUnique.mockResolvedValueOnce(null);
    await expect(service.authenticate(`Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses current database permissions instead of stale permissions at login', async () => {
    const token = service.issue(admin).accessToken;
    const changed = { ...admin, role: 'Admin', modules: { ai_docs: false, companies: {} } };
    mockPrisma.admin.findUnique.mockResolvedValueOnce(changed);
    await expect(service.authenticate(`Bearer ${token}`)).resolves.toMatchObject({ role: 'Admin', modules: changed.modules });
  });

  it('revokes sessions immediately after the account is suspended', async () => {
    const token = service.issue(admin).accessToken;
    mockPrisma.admin.findUnique.mockResolvedValueOnce({ ...admin, status: 'Suspended' });
    await expect(service.authenticate(`Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed by another server secret', async () => {
    const token = service.issue(admin).accessToken;
    process.env.SESSION_SECRET = 'another-secret-with-at-least-32-bytes-long';
    const otherService = new AuthSessionService();
    await expect(otherService.authenticate(`Bearer ${token}`)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails startup for an explicitly configured weak secret', () => {
    process.env.SESSION_SECRET = 'short';
    expect(() => new AuthSessionService()).toThrow('at least 32 bytes');
  });

  it('generates independent secure secrets when no shared secret is configured', async () => {
    delete process.env.SESSION_SECRET;
    const previousJwt = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      const first = new AuthSessionService();
      const second = new AuthSessionService();
      await expect(second.authenticate(`Bearer ${first.issue(admin).accessToken}`)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(warning).toHaveBeenCalled();
    } finally {
      if (previousJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwt;
    }
  });
});

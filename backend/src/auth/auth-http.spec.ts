import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { AuthSessionModule } from './auth-session.module';
import { AppController } from '../app.controller';
import { AppService } from '../app.service';
import { CompaniesController } from '../companies/companies.controller';
import { DocumentController } from '../documentation/document.controller';
import { DocumentService } from '../documentation/document.service';
import { DriveService } from '../documentation/drive.service';

jest.mock('@prisma/client', () => {
  const mockClient = {
    admin: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn(), delete: jest.fn() },
    company: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn(),
  };
  return { PrismaClient: jest.fn(() => mockClient), mockClient };
});
jest.mock('bcryptjs', () => ({ compare: jest.fn(async (value: string) => value === 'test-correct-password'), hash: jest.fn().mockResolvedValue('new-hashed-password') }));
const mockPrisma = jest.requireMock('@prisma/client').mockClient;
const phase3Prisma = jest.requireMock<{
  mockClient: {
    admin: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
}>('@prisma/client').mockClient;

describe('HTTP session protection', () => {
  const admin = { id: 7, username: 'real-user', password: 'test-stored-password-hash', role: 'Admin', status: 'Active', modules: { ai_docs: true, companies: { Surgicom: true } } };
  const docs = { getActiveNotifications: jest.fn().mockResolvedValue([]), searchDocuments: jest.fn().mockResolvedValue({ answer: 'mocked answer' }) };
  const previousSecret = process.env.SESSION_SECRET;
  let app: INestApplication<Server>;

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'http-test-session-key-with-at-least-32-bytes';
    const module = await Test.createTestingModule({
      imports: [AuthSessionModule],
      controllers: [AppController, CompaniesController, DocumentController],
      providers: [AppService, { provide: DocumentService, useValue: docs }, { provide: DriveService, useValue: {} }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.admin.findFirst.mockResolvedValue(admin);
    mockPrisma.admin.findUnique.mockResolvedValue(admin);
    mockPrisma.admin.findMany.mockResolvedValue([admin]);
    mockPrisma.admin.count.mockResolvedValue(2);
    mockPrisma.$transaction.mockReset().mockImplementation(async mutation => mutation(mockPrisma));
    mockPrisma.company.findUnique.mockResolvedValue({ id: 'company-id' });
    mockPrisma.company.findMany.mockResolvedValue([{ name: 'Surgicom' }]);
  });
  afterAll(async () => {
    await app.close();
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  });

  const login = async (username = 'real-user') => {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ username, password: 'test-correct-password' }).expect(201);
    return response.body.accessToken as string;
  };

  it('keeps health public and issues a signed session only after valid credentials', async () => {
    await request(app.getHttpServer()).get('/').expect(200);
    const failed = await request(app.getHttpServer()).post('/auth/login').send({ username: 'real-user', password: 'wrong' }).expect(401);
    expect(failed.body.accessToken).toBeUndefined();
    const accessToken = await login();
    expect(accessToken.split('.')).toHaveLength(3);
  });

  it('protects document reads and user management before controllers are invoked', async () => {
    await request(app.getHttpServer()).get('/api/docs/notifications').set('x-company', 'Surgicom').expect(401);
    await request(app.getHttpServer()).get('/admins').expect(401);
    await request(app.getHttpServer()).patch('/api/admins/7/password').send({ password: 'unauthorized-change' }).expect(401);
    expect(docs.getActiveNotifications).not.toHaveBeenCalled();
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });

  it('allows authenticated reads without revealing password hashes', async () => {
    const token = await login();
    const admins = await request(app.getHttpServer()).get('/admins').set('Authorization', `Bearer ${token}`).expect(200);
    expect(admins.body[0].password).toBeUndefined();
    await request(app.getHttpServer()).get('/api/docs/notifications').set('Authorization', `Bearer ${token}`).set('x-company', 'Surgicom').expect(200);
    expect(docs.getActiveNotifications).toHaveBeenCalledWith('Surgicom');
  });

  it('uses session identity for search and rejects unauthorized company or admin writes', async () => {
    const token = await login();
    await request(app.getHttpServer()).post('/api/docs/search').set('Authorization', `Bearer ${token}`).set('x-company', 'Surgicom').set('x-username', 'spoofed-user').send({ query: 'test question', model: 'gemini-3.5-flash-lite' }).expect(201);
    expect(docs.searchDocuments).toHaveBeenCalledWith('test question', 'Surgicom', 'real-user', 'gemini-3.5-flash-lite');
    await request(app.getHttpServer()).get('/api/docs/notifications').set('Authorization', `Bearer ${token}`).set('x-company', 'Olten').expect(403);
    await request(app.getHttpServer()).patch('/admins/7/password').set('Authorization', `Bearer ${token}`).send({ password: 'unauthorized-change' }).expect(403);
    await request(app.getHttpServer()).post('/companies').set('Authorization', `Bearer ${token}`).send({ name: 'Unauthorized' }).expect(403);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
    expect(mockPrisma.company.create).not.toHaveBeenCalled();
  });

  it('scopes ordinary-user layout updates to the authenticated ID when username fallback is used', async () => {
    const token = await login();
    await request(app.getHttpServer()).patch('/admins/real-user/preferences').set('Authorization', `Bearer ${token}`).send({ moduleOrder: ['ai_docs'] }).expect(200);
    expect(mockPrisma.admin.findFirst).toHaveBeenLastCalledWith({ where: { id: admin.id } });
    expect(mockPrisma.admin.update).toHaveBeenCalledWith({ where: { id: admin.id }, data: { moduleOrder: ['ai_docs'] } });
  });

  it.each(['7foo', '7'])('does not interpret an ordinary user numeric-prefix username as another account ID', async username => {
    const namedAdmin = { ...admin, id: 99, username };
    mockPrisma.admin.findFirst.mockResolvedValue(namedAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(namedAdmin);
    const token = await login(username);
    await request(app.getHttpServer()).patch(`/admins/${username}/preferences`).set('Authorization', `Bearer ${token}`).send({ moduleOrder: ['ai_docs'] }).expect(200);
    expect(mockPrisma.admin.findFirst).toHaveBeenLastCalledWith({ where: { id: 99 } });
    expect(mockPrisma.admin.update).toHaveBeenCalledWith({ where: { id: 99 }, data: { moduleOrder: ['ai_docs'] } });
  });

  it('uses a strict username query without undefined filters for a Super Admin layout target', async () => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    mockPrisma.admin.findFirst.mockResolvedValue(superAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token = await login();
    await request(app.getHttpServer()).patch('/admins/7foo/preferences').set('Authorization', `Bearer ${token}`).send({ moduleOrder: ['ai_docs'] }).expect(200);
    expect(mockPrisma.admin.findFirst).toHaveBeenLastCalledWith({ where: { username: { equals: '7foo', mode: 'insensitive' } } });
  });

  it('blocks ordinary users from editing their own permissions through the UI edit route', async () => {
    const token = await login();
    await request(app.getHttpServer()).patch('/admins/7').set('Authorization', `Bearer ${token}`).send({ role: 'Super Admin', modules: { ai_docs: true } }).expect(403);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });

  it('allows Super Admin permission editing and preserves the password when its field is blank', async () => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    mockPrisma.admin.findFirst.mockResolvedValue(superAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token = await login();
    const modules = { ai_docs: true, companies: { Surgicom: true } };
    const response = await request(app.getHttpServer()).patch('/api/admins/7').set('Authorization', `Bearer ${token}`).send({ username: 'real-user', password: '', role: 'Super Admin', status: 'Active', modules }).expect(200);
    expect(mockPrisma.admin.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { username: 'real-user', role: 'Super Admin', status: 'Active', modules } });
    expect(jest.requireMock('bcryptjs').hash).not.toHaveBeenCalled();
    expect(response.body.password).toBeUndefined();
  });

  it.each([true, false])('allows Super Admin to save importation permission flags set to %s', async enabled => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    mockPrisma.admin.findFirst.mockResolvedValue(superAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token = await login();
    const modules = { importation: enabled, importation_approve: enabled, companies: { Surgicom: true } };
    await request(app.getHttpServer()).patch('/api/admins/7').set('Authorization', `Bearer ${token}`).send({ modules }).expect(200);
    expect(mockPrisma.admin.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { modules } });
  });

  it.each([{ importation: 'true' }, { importation_approve: 1 }])('rejects non-boolean importation permissions: %o', async flags => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    mockPrisma.admin.findFirst.mockResolvedValue(superAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token = await login();
    await request(app.getHttpServer()).patch('/api/admins/7').set('Authorization', `Bearer ${token}`).send({ modules: flags }).expect(400);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });

  it('allows Super Admin to assign Phase 3 roles, module flags, and exact workspace approval limits', async () => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    phase3Prisma.admin.findFirst.mockResolvedValue(superAdmin);
    phase3Prisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token: unknown = await login();
    const modules = {
      finance: true,
      books: true,
      service: false,
      executive: true,
      ai_assistant: true,
      erpRoles: ['Finance', 'Management'],
      approvalLimits: { Surgicom: '9999999999999999.99' },
      companies: { Surgicom: true },
    };
    await request(app.getHttpServer())
      .patch('/api/admins/7/modules')
      .set('Authorization', `Bearer ${String(token)}`)
      .send({ modules })
      .expect(200);
    expect(phase3Prisma.admin.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { modules },
    });
  });

  it.each([
    { erpRoles: ['Finance', 'Finance'] },
    { erpRoles: ['Owner'] },
    { erpRoles: 'Finance' },
    { approvalLimits: { Surgicom: 100 } },
    { approvalLimits: { Surgicom: '0.00' } },
    { approvalLimits: { Surgicom: '100.001' } },
    { approvalLimits: { Surgicom: '-1' } },
    { finance: 'true' },
  ])('rejects invalid Phase 3 permission fields %o', async (modules) => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    phase3Prisma.admin.findFirst.mockResolvedValue(superAdmin);
    phase3Prisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token: unknown = await login();
    await request(app.getHttpServer())
      .patch('/api/admins/7/modules')
      .set('Authorization', `Bearer ${String(token)}`)
      .send({ modules })
      .expect(400);
    expect(phase3Prisma.admin.update).not.toHaveBeenCalled();
  });

  it('prevents ordinary Admin accounts from granting Phase 3 roles or approval limits', async () => {
    const token: unknown = await login();
    await request(app.getHttpServer())
      .patch('/api/admins/7/modules')
      .set('Authorization', `Bearer ${String(token)}`)
      .send({
        modules: {
          finance: true,
          erpRoles: ['Management'],
          approvalLimits: { Surgicom: '1000000' },
        },
      })
      .expect(403);
    expect(phase3Prisma.admin.update).not.toHaveBeenCalled();
  });

  it('hashes new passwords on an authorized edit and returns no password material', async () => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    mockPrisma.admin.findFirst.mockResolvedValue(superAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token = await login();
    const response = await request(app.getHttpServer()).patch('/admins/7').set('Authorization', `Bearer ${token}`).send({ password: 'test-new-password' }).expect(200);
    expect(jest.requireMock('bcryptjs').hash).toHaveBeenCalledWith('test-new-password', 10);
    expect(mockPrisma.admin.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { password: 'new-hashed-password' } });
    expect(response.body.password).toBeUndefined();
  });

  it.each([{ role: 'Owner' }, { status: 'Unknown' }, { modules: { ai_docs: 'true' } }, { modules: { companies: { Surgicom: 'true' } } }, { isOnline: true }, { password: 'short' }])('rejects invalid management payloads without changing the account', async payload => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    mockPrisma.admin.findFirst.mockResolvedValue(superAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token = await login();
    await request(app.getHttpServer()).patch('/admins/7').set('Authorization', `Bearer ${token}`).send(payload).expect(400);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });

  it('honors the UI role, status and permission fields on authorized user creation', async () => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    mockPrisma.admin.findFirst.mockResolvedValue(superAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token = await login();
    mockPrisma.admin.findFirst.mockResolvedValueOnce(null);
    const modules = { ai_docs: true, companies: { Surgicom: true } };
    const response = await request(app.getHttpServer()).post('/admins').set('Authorization', `Bearer ${token}`).send({ username: 'new-admin', password: 'test-new-password', role: 'Super Admin', status: 'Active', modules }).expect(201);
    expect(mockPrisma.admin.create).toHaveBeenCalledWith({ data: { username: 'new-admin', password: 'new-hashed-password', role: 'Super Admin', status: 'Active', modules } });
    expect(response.body.password).toBeUndefined();
  });

  it.each([{ role: 'Admin' }, { status: 'Suspended' }])('preserves the final active Super Admin during editing', async change => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    mockPrisma.admin.findFirst.mockResolvedValue(superAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(superAdmin);
    mockPrisma.admin.count.mockResolvedValue(1);
    const token = await login();
    await request(app.getHttpServer()).patch('/admins/7').set('Authorization', `Bearer ${token}`).send(change).expect(403);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });

  it('rejects suspended-user login and invalidates an existing document session after suspension', async () => {
    const token = await login();
    mockPrisma.admin.findFirst.mockResolvedValue({ ...admin, status: 'Suspended' });
    await request(app.getHttpServer()).post('/auth/login').send({ username: 'real-user', password: 'test-correct-password' }).expect(401);
    mockPrisma.admin.findUnique.mockResolvedValue({ ...admin, status: 'Suspended' });
    await request(app.getHttpServer()).get('/api/docs/notifications').set('Authorization', `Bearer ${token}`).set('x-company', 'Surgicom').expect(401);
    expect(docs.getActiveNotifications).not.toHaveBeenCalled();
  });

  it.each([
    { method: 'patch', path: '/admins/7', body: { role: 'Admin' }, write: 'update' },
    { method: 'patch', path: '/api/admins/7/role', body: { role: 'Admin' }, write: 'update' },
    { method: 'delete', path: '/admins/7', body: {}, write: 'delete' },
  ])('rechecks the last active Super Admin after a serialization conflict on $path', async endpoint => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    mockPrisma.admin.findFirst.mockResolvedValue(superAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token = await login();
    mockPrisma.$transaction.mockImplementationOnce(async mutation => {
      await mutation(mockPrisma);
      // Simulate a failed commit after another transaction reduced the active count.
      mockPrisma.admin.count.mockResolvedValue(1);
      throw { code: 'P2034' };
    });
    const serverRequest = request(app.getHttpServer());
    const operation = endpoint.method === 'delete' ? serverRequest.delete(endpoint.path) : serverRequest.patch(endpoint.path);
    await operation.set('Authorization', `Bearer ${token}`).send(endpoint.body).expect(403);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mockPrisma.admin.count).toHaveBeenCalledTimes(2);
    // The first attempted write belongs to the rolled-back transaction; no second write is allowed.
    expect(mockPrisma.admin[endpoint.write]).toHaveBeenCalledTimes(1);
    for (const call of mockPrisma.$transaction.mock.calls) {
      expect(call[1]).toMatchObject({ isolationLevel: 'Serializable' });
    }
  });

  it('retries a successful serialized edit without hashing the password again', async () => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    mockPrisma.admin.findFirst.mockResolvedValue(superAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token = await login();
    mockPrisma.$transaction.mockImplementationOnce(async mutation => {
      await mutation(mockPrisma);
      throw { code: 'P2034' };
    });
    await request(app.getHttpServer()).patch('/admins/7').set('Authorization', `Bearer ${token}`).send({ password: 'test-new-password' }).expect(200);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    expect(jest.requireMock('bcryptjs').hash).toHaveBeenCalledTimes(1);
    expect(mockPrisma.admin.update).toHaveBeenCalledTimes(2);
    expect(mockPrisma.admin.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: { password: 'new-hashed-password' } });
  });

  it('fails closed after three serialization conflicts without applying an unsafe edit', async () => {
    const superAdmin = { ...admin, role: 'Super Admin' };
    mockPrisma.admin.findFirst.mockResolvedValue(superAdmin);
    mockPrisma.admin.findUnique.mockResolvedValue(superAdmin);
    const token = await login();
    mockPrisma.$transaction.mockRejectedValue({ code: 'P2034' });
    await request(app.getHttpServer()).patch('/admins/7').set('Authorization', `Bearer ${token}`).send({ role: 'Admin' }).expect(409);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });
});

import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AuthSessionModule } from '../auth/auth-session.module';
import { AuthSessionService, SessionAdmin } from '../auth/auth-session.service';
import { DocsAuthGuard } from '../auth/docs-auth.guard';
import { DocumentationModule } from './documentation.module';
import { DocumentService } from './document.service';
import { DriveService } from './drive.service';
import { GeminiService } from './gemini.service';
import { ExpiryCronService } from './expiry-cron.service';
import { CompaniesController } from '../companies/companies.controller';

jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => ({
  admin: { findUnique: jest.fn() }, company: { findUnique: jest.fn() },
  $disconnect: jest.fn(async () => undefined),
})) }));
jest.mock('./document.service', () => ({ DocumentService: jest.fn() }));
jest.mock('./drive.service', () => ({ DriveService: jest.fn(), DocumentRangeException: class extends Error {} }));
jest.mock('./gemini.service', () => ({ GeminiService: jest.fn() }));
jest.mock('@nestjs/schedule', () => {
  const { Module } = jest.requireActual('@nestjs/common');
  class ScheduleModule {}
  Module({})(ScheduleModule);
  return { ScheduleModule: { forRoot: () => ScheduleModule },
    Cron: () => () => {}, CronExpression: { EVERY_MINUTE: '* * * * *' } };
});

describe('DocumentationModule authentication wiring', () => {
  let app: INestApplication;
  const docs = { getActiveNotifications: jest.fn(async () => []),
    deleteCompanyWorkspace: jest.fn(async (name: string) => ({ id: 'deleted-company', name })) };
  const administrator: SessionAdmin = { id: 7, username: 'module-test', password: 'stored-password',
    role: 'Admin', status: 'Active', modules: { ai_docs: true, companies: { Olten: true } } };

  afterEach(async () => { await app?.close(); jest.clearAllMocks(); });

  async function start(imports: Array<typeof DocumentationModule | typeof AuthSessionModule>, includeCompanies = false) {
    const module = await Test.createTestingModule({ imports, controllers: includeCompanies ? [CompaniesController] : [] })
      .overrideProvider(DocumentService).useValue(docs)
      .overrideProvider(DriveService).useValue({})
      .overrideProvider(GeminiService).useValue({})
      .overrideProvider(ExpiryCronService).useValue({})
      .compile();
    app = module.createNestApplication();
    await app.init();
    const sessions = module.get(AuthSessionService);
    const guard = module.select(DocumentationModule).get(DocsAuthGuard, { strict: true });
    expect(Reflect.get(guard, 'sessions')).toBe(sessions);
    const database = (PrismaClient as unknown as jest.Mock).mock.results.at(-1)!.value;
    database.admin.findUnique.mockResolvedValue(administrator);
    database.company.findUnique.mockResolvedValue({ id: 1 });
    return { module, sessions };
  }

  it('starts the actual feature module and protects its routes through the imported session service', async () => {
    const { sessions } = await start([DocumentationModule]);
    await request(app.getHttpServer()).get('/api/docs/notifications').set('x-company', 'Olten').expect(401);
    expect(docs.getActiveNotifications).not.toHaveBeenCalled();
    const token = sessions.issue(administrator).accessToken;
    await request(app.getHttpServer()).get('/api/docs/notifications')
      .set('Authorization', `Bearer ${token}`).set('x-company', 'Olten').expect(200, []);
    expect(docs.getActiveNotifications).toHaveBeenCalledWith('Olten');
    await expect(sessions.authenticate('Bearer invalid')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('shares one session signer when the parent and feature module both import AuthSessionModule', async () => {
    const { module, sessions } = await start([AuthSessionModule, DocumentationModule]);
    expect(module.select(AuthSessionModule).get(AuthSessionService, { strict: true })).toBe(sessions);
    expect(PrismaClient).toHaveBeenCalledTimes(1);
    const token = sessions.issue(administrator).accessToken;
    await request(app.getHttpServer()).get('/api/docs/notifications')
      .set('Authorization', `Bearer ${token}`).set('x-company', 'Olten').expect(200, []);
  });

  it('exports document storage deletion to the parent company controller while keeping Super Admin authorization', async () => {
    const { sessions } = await start([AuthSessionModule, DocumentationModule], true);
    await request(app.getHttpServer()).delete('/companies/Olten').expect(401);
    const token = sessions.issue(administrator).accessToken;
    await request(app.getHttpServer()).delete('/companies/Olten').set('Authorization', `Bearer ${token}`).expect(403);
    expect(docs.deleteCompanyWorkspace).not.toHaveBeenCalled();
    const database = (PrismaClient as unknown as jest.Mock).mock.results.at(-1)!.value;
    database.admin.findUnique.mockResolvedValue({ ...administrator, role: 'Super Admin' });
    await request(app.getHttpServer()).delete('/companies/Olten').set('Authorization', `Bearer ${token}`)
      .expect(200, { id: 'deleted-company', name: 'Olten' });
    expect(docs.deleteCompanyWorkspace).toHaveBeenCalledWith('Olten');
  });
});

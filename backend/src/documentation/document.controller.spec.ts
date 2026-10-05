import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Readable } from 'stream';
import request from 'supertest';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DriveService } from './drive.service';
import { DocsAuthGuard } from '../auth/docs-auth.guard';
import { AuthSessionService } from '../auth/auth-session.service';

jest.mock('./document.service', () => ({ DocumentService: jest.fn() }));
jest.mock('./drive.service', () => ({ DriveService: jest.fn() }));
jest.mock('../auth/auth-session.service', () => ({ AuthSessionService: jest.fn() }));

describe('document HTTP limits and secure source responses', () => {
  let app: INestApplication;
  const previousModel = process.env.GEMINI_MODEL;
  const previousAllowlist = process.env.GEMINI_SEARCH_MODELS;
  const docs = {
    searchDocuments: jest.fn(async () => ({ answer: 'mock answer' })),
    processNewDocument: jest.fn(async () => ({ id: 1 })),
    clearReminder: jest.fn(async () => ({ id: 42, reminder: null, reminderValue: null,
      reminderUnit: null, reminderDays: null, reminderDisabled: true })),
    getDocumentContent: jest.fn(async () => ({ stream: Readable.from(Buffer.from('%PDF mock source')),
      mimeType: 'application/pdf', name: 'unsafe"\r\nfolder/permit.pdf', size: 16 })),
  };
  const sessions = {
    authenticate: jest.fn(async (authorization: string) => {
      if (authorization !== 'Bearer valid-test-session') throw new UnauthorizedException();
      return { id: 7, username: 'authenticated-user', role: 'Admin',
        modules: { ai_docs: true, companies: { Olten: true } } };
    }),
    companyExists: jest.fn(async () => true),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DocumentController],
      providers: [DocsAuthGuard, { provide: DocumentService, useValue: docs },
        { provide: DriveService, useValue: {} }, { provide: AuthSessionService, useValue: sessions }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_SEARCH_MODELS;
  });
  afterAll(async () => {
    await app.close();
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
    if (previousAllowlist === undefined) delete process.env.GEMINI_SEARCH_MODELS;
    else process.env.GEMINI_SEARCH_MODELS = previousAllowlist;
  });

  const authorized = (test: request.Test, company = 'Olten') =>
    test.set('Authorization', 'Bearer valid-test-session').set('x-company', company);

  it.each(['gemini-3.6-flash', 'gemini-3.5-flash-lite'])
    ('allows the frontend search model %s and uses authenticated identity', async model => {
      await authorized(request(app.getHttpServer()).post('/api/docs/search')).set('x-username', 'spoofed')
        .send({ query: 'When does my permit expire?', model }).expect(201);
      expect(docs.searchDocuments).toHaveBeenCalledWith('When does my permit expire?', 'Olten', 'authenticated-user', model);
    });

  it('allows only models explicitly enabled by server configuration', async () => {
    process.env.GEMINI_MODEL = 'configured-model';
    process.env.GEMINI_SEARCH_MODELS = ' alternate-model, another-model ';
    for (const model of ['configured-model', 'alternate-model', 'another-model']) {
      await authorized(request(app.getHttpServer()).post('/api/docs/search')).send({ query: 'Explain this permit', model }).expect(201);
    }
    await authorized(request(app.getHttpServer()).post('/api/docs/search'))
      .send({ query: 'Explain this permit', model: 'arbitrary-expensive-model' }).expect(400);
    expect(docs.searchDocuments).toHaveBeenCalledTimes(3);
  });

  it('rejects excessive queries and malformed models before document search starts', async () => {
    for (const body of [{ query: 'q'.repeat(8193) }, { query: 'question', model: ['gemini-3.6-flash'] },
      { query: 'question', model: '../private-model' }]) {
      await authorized(request(app.getHttpServer()).post('/api/docs/search')).send(body).expect(400);
    }
    expect(docs.searchDocuments).not.toHaveBeenCalled();
  });

  it('requires authorization and company permission before content or reminder mutation', async () => {
    await request(app.getHttpServer()).get('/api/docs/42/content').set('x-company', 'Olten').expect(401);
    await authorized(request(app.getHttpServer()).get('/api/docs/42/content'), 'Other').expect(403);
    await authorized(request(app.getHttpServer()).delete('/api/docs/42/reminder'), 'Other').expect(403);
    expect(docs.getDocumentContent).not.toHaveBeenCalled();
    expect(docs.clearReminder).not.toHaveBeenCalled();
  });

  it('returns null reminder values when the exact authorized document is skipped', async () => {
    const response = await authorized(request(app.getHttpServer()).delete('/api/docs/42/reminder')).expect(200);
    expect(response.body).toMatchObject({ reminder: null, reminderValue: null, reminderUnit: null, reminderDays: null });
    expect(docs.clearReminder).toHaveBeenCalledWith('42', 'Olten');
  });

  it('streams source content privately with safe MIME and filename headers', async () => {
    const response = await authorized(request(app.getHttpServer()).get('/api/docs/42/content?source=document')).expect(200);
    expect(docs.getDocumentContent).toHaveBeenCalledWith('42', 'Olten', 'document');
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-disposition']).toContain("inline; filename=\"document\"; filename*=UTF-8''unsafe___folder_permit.pdf");
    expect(response.headers['content-disposition']).not.toMatch(/[\r\n]/);
    expect(response.body).toEqual(Buffer.from('%PDF mock source'));
  });

  it('accepts separate valid uploads without imposing a bulk-upload quota', async () => {
    await Promise.all(['first.pdf', 'second.pdf'].map(filename =>
      authorized(request(app.getHttpServer()).post('/api/docs/upload'))
        .field('reminderSetup', 'after-upload').attach('file', Buffer.from('PDF'), filename).expect(201)));
    expect(docs.processNewDocument).toHaveBeenCalledTimes(2);
  });

  it('rejects multiple files in one multipart request before document processing', async () => {
    await authorized(request(app.getHttpServer()).post('/api/docs/upload'))
      .attach('file', Buffer.from('PDF'), 'first.pdf').attach('file', Buffer.from('PDF'), 'second.pdf').expect(400);
    expect(docs.processNewDocument).not.toHaveBeenCalled();
  });

  it('rejects files larger than 50 MiB before processing or Gemini calls', async () => {
    await authorized(request(app.getHttpServer()).post('/api/docs/upload'))
      .attach('file', Buffer.alloc(50 * 1024 * 1024 + 1), 'too-large.pdf').expect(413);
    expect(docs.processNewDocument).not.toHaveBeenCalled();
  });
});

import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Readable } from 'stream';
import { request as httpRequest } from 'http';
import request from 'supertest';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DriveService, DocumentRangeException } from './drive.service';
import { DocsAuthGuard } from '../auth/docs-auth.guard';
import { AuthSessionService } from '../auth/auth-session.service';

jest.mock('./document.service', () => ({ DocumentService: jest.fn() }));
jest.mock('./drive.service', () => ({ ...jest.requireActual('./drive.service'), DriveService: jest.fn() }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../auth/auth-session.service', () => ({ AuthSessionService: jest.fn() }));

describe('document HTTP limits and secure source responses', () => {
  let app: INestApplication;
  const previousModel = process.env.GEMINI_MODEL;
  const previousAllowlist = process.env.GEMINI_SEARCH_MODELS;
  const docs = {
    searchDocuments: jest.fn(async () => ({ answer: 'mock answer' })),
    processNewDocument: jest.fn(async () => ({ id: 1 })),
    replaceDocument: jest.fn(async () => ({ id: 42, driveFileId: 'new-source' })),
    updateNotificationStatus: jest.fn(async () => ({ success: true })),
    clearReminder: jest.fn(async () => ({ id: 42, reminder: null, reminderValue: null,
      reminderUnit: null, reminderDays: null, reminderDisabled: true })),
    getDocumentContent: jest.fn(async () => ({ stream: Readable.from(Buffer.from('%PDF mock source')),
      mimeType: 'application/pdf', name: 'unsafe"\r\nfolder/permit.pdf', size: 16, totalSize: 16 } as any)),
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
    await app.listen(0, '127.0.0.1');
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

  it('passes the displayed expiry and exact source to the guarded reminder status mutation', async () => {
    await authorized(request(app.getHttpServer()).patch('/api/docs/notifications/9/status'))
      .send({ status: 'FULFILLED', expectedExpiryDate: '2026-10-12', expectedDriveFileId: 'old-source' }).expect(200);
    expect(docs.updateNotificationStatus).toHaveBeenCalledWith(9, 'FULFILLED', 'Olten',
      { expectedExpiryDate: '2026-10-12', expectedDriveFileId: 'old-source' });
  });

  it('streams source content privately with safe MIME and filename headers', async () => {
    const response = await authorized(request(app.getHttpServer()).get('/api/docs/42/content?source=document')).expect(200);
    expect(docs.getDocumentContent).toHaveBeenCalledWith('42', 'Olten', 'document', undefined, undefined);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-length']).toBe('16');
    expect(response.headers['content-encoding']).toBe('identity');
    expect(response.headers['content-disposition']).toContain("inline; filename=\"document\"; filename*=UTF-8''unsafe___folder_permit.pdf");
    expect(response.headers['content-disposition']).not.toMatch(/[\r\n]/);
    expect(response.body).toEqual(Buffer.from('%PDF mock source'));
  });

  it('passes authenticated range requests and emits exact partial status and headers', async () => {
    docs.getDocumentContent.mockResolvedValueOnce({ stream: Readable.from(Buffer.from('%PDF')),
      mimeType: 'application/pdf', name: 'permit.pdf', size: 4, totalSize: 16, statusCode: 206,
      contentRange: 'bytes 0-3/16', etag: '"source-version"' });
    const response = await authorized(request(app.getHttpServer()).get('/api/docs/42/content?source=document'))
      .set('Range', 'bytes=0-3').set('If-Range', '"source-version"').expect(206);
    expect(docs.getDocumentContent).toHaveBeenCalledWith('42', 'Olten', 'document', 'bytes=0-3', '"source-version"');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-range']).toBe('bytes 0-3/16');
    expect(response.headers['content-length']).toBe('4');
    expect(response.headers.etag).toBe('"source-version"');
    expect(response.body).toEqual(Buffer.from('%PDF'));
  });

  it('returns the current document size with an unsatisfiable range after authorization', async () => {
    docs.getDocumentContent.mockRejectedValueOnce(new DocumentRangeException(16));
    const response = await authorized(request(app.getHttpServer()).get('/api/docs/42/content'))
      .set('Range', 'bytes=50-').expect(416);
    expect(response.headers['content-range']).toBe('bytes */16');
    expect(response.headers['accept-ranges']).toBe('bytes');
  });

  it('destroys the upstream stream when a progressive client cancels after headers', async () => {
    const stream = new Readable({ read() { this.push(Buffer.alloc(8192)); } });
    const destroyed = new Promise<void>(resolve => stream.once('close', resolve));
    docs.getDocumentContent.mockResolvedValueOnce({ stream, mimeType: 'application/pdf', size: 100 * 1024 * 1024, totalSize: 100 * 1024 * 1024 });
    const address = app.getHttpServer().address();
    const pending = httpRequest({ hostname: '127.0.0.1', port: address.port, path: '/api/docs/42/content',
      headers: { Authorization: 'Bearer valid-test-session', 'x-company': 'Olten' } }, response => {
      response.once('data', () => { response.destroy(); pending.destroy(); });
    });
    pending.on('error', () => undefined);
    pending.end();
    await destroyed;
    expect(stream.destroyed).toBe(true);
  });

  it('accepts separate valid uploads without imposing a bulk-upload quota', async () => {
    await Promise.all(['first.pdf', 'second.pdf'].map(filename =>
      authorized(request(app.getHttpServer()).post('/api/docs/upload'))
        .field('reminderSetup', 'after-upload').attach('file', Buffer.from('PDF'), filename).expect(201)));
    expect(docs.processNewDocument).toHaveBeenCalledTimes(2);
  });

  it('replaces one exact authorized source using authenticated identity', async () => {
    const response = await authorized(request(app.getHttpServer()).post('/api/docs/42/replace'))
      .set('x-username', 'spoofed').field('expectedDriveFileId', 'old-source')
      .attach('file', Buffer.from('%PDF replacement'), 'renewed.pdf').expect(201);
    expect(response.body).toMatchObject({ id: 42, driveFileId: 'new-source' });
    expect(docs.replaceDocument).toHaveBeenCalledWith('42', expect.objectContaining({ originalname: 'renewed.pdf' }),
      'Olten', 'authenticated-user', 'old-source');
  });

  it('rejects unauthenticated, unauthorized, missing, multiple and oversized replacement files before processing', async () => {
    await request(app.getHttpServer()).post('/api/docs/42/replace').set('x-company', 'Olten')
      .attach('file', Buffer.from('PDF'), 'renewed.pdf').expect(401);
    await authorized(request(app.getHttpServer()).post('/api/docs/42/replace'), 'Other')
      .attach('file', Buffer.from('PDF'), 'renewed.pdf').expect(403);
    await authorized(request(app.getHttpServer()).post('/api/docs/42/replace')).expect(400);
    await authorized(request(app.getHttpServer()).post('/api/docs/42/replace'))
      .attach('file', Buffer.from('PDF'), 'one.pdf').attach('file', Buffer.from('PDF'), 'two.pdf').expect(400);
    await authorized(request(app.getHttpServer()).post('/api/docs/42/replace'))
      .attach('file', Buffer.alloc(50 * 1024 * 1024 + 1), 'large.pdf').expect(413);
    expect(docs.replaceDocument).not.toHaveBeenCalled();
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

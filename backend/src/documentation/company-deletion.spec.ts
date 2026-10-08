jest.mock('@prisma/client', () => {
  const database = { company: {}, document: {}, searchHistory: {}, $transaction: jest.fn() };
  return { PrismaClient: jest.fn(() => database), database };
});
jest.mock('./gemini.service', () => ({ GeminiService: jest.fn() }));
jest.mock('./drive.service', () => ({ DriveService: jest.fn() }));

import { BadGatewayException } from '@nestjs/common';
import { DocumentService } from './document.service';
import { ExpiryExtractorService } from './expiry-extractor.service';
import { CompaniesController } from '../companies/companies.controller';

const database = jest.requireMock('@prisma/client').database;

describe('company and document storage deletion', () => {
  let service: DocumentService;
  let drive: any;
  let gemini: any;
  const workspace = { id: 'original-company', name: 'Olten' };

  beforeEach(() => {
    database.company = {
      findUnique: jest.fn(async () => workspace),
      delete: jest.fn(async () => workspace),
    };
    database.document = {
      findMany: jest.fn(async () => [{ geminiFileId: 'files/one' }, { geminiFileId: 'files/one' }, { geminiFileId: null }]),
      deleteMany: jest.fn(async () => ({ count: 3 })),
    };
    database.searchHistory = { deleteMany: jest.fn(async () => ({ count: 2 })) };
    database.$transaction.mockReset().mockImplementation(async callback => callback(database));
    drive = {
      deleteCompanyFolder: jest.fn(async (_company, complete) => complete()),
      createSubFolder: jest.fn(async () => ({ id: 'existing-upload-folder' })),
    };
    gemini = { deleteGeminiFile: jest.fn(async () => undefined) };
    service = new DocumentService(gemini, drive, new ExpiryExtractorService());
  });

  it('makes the company endpoint await Drive cleanup, then atomically removes only its documents, history and company', async () => {
    const companyCache = Reflect.get(service, 'companyCache') as Map<string, unknown>;
    companyCache.set('Olten', { cacheName: 'old-cache' });
    companyCache.set('Other Company', { cacheName: 'other-cache' });
    let commit!: () => Promise<unknown>;
    let began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    let finish!: (value: unknown) => void;
    drive.deleteCompanyFolder.mockImplementationOnce((_name, callback) => {
      commit = callback;
      began();
      return new Promise(resolve => { finish = resolve; });
    });
    const result = new CompaniesController(service).remove('Olten');
    await started;
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.company.delete).not.toHaveBeenCalled();
    const deleted = await commit();
    finish(deleted);
    await expect(result).resolves.toEqual(workspace);
    expect(database.document.findMany).toHaveBeenCalledWith({ where: { company: 'Olten' }, select: { geminiFileId: true } });
    expect(database.document.deleteMany).toHaveBeenCalledWith({ where: { company: 'Olten' } });
    expect(database.searchHistory.deleteMany).toHaveBeenCalledWith({ where: { company: 'Olten' } });
    expect(database.company.delete).toHaveBeenCalledWith({ where: { id: workspace.id, name: 'Olten' } });
    expect(companyCache.has('Olten')).toBe(false);
    expect(companyCache.has('Other Company')).toBe(true);
    expect(gemini.deleteGeminiFile.mock.calls).toEqual([['files/one']]);
  });

  it('does not touch Drive for a nonexistent or invalid company', async () => {
    database.company.findUnique.mockResolvedValueOnce(null);
    await expect(service.deleteCompanyWorkspace('Missing')).rejects.toMatchObject({ status: 404 });
    await expect(service.deleteCompanyWorkspace(' ')).rejects.toMatchObject({ status: 400 });
    expect(drive.deleteCompanyFolder).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('preserves company and records when Drive deletion fails and permits retry', async () => {
    drive.deleteCompanyFolder.mockRejectedValueOnce(new BadGatewayException('Drive unavailable'));
    await expect(service.deleteCompanyWorkspace('Olten')).rejects.toMatchObject({ status: 502 });
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.company.delete).not.toHaveBeenCalled();
    expect(database.document.deleteMany).not.toHaveBeenCalled();
    expect(gemini.deleteGeminiFile).not.toHaveBeenCalled();
    await expect(service.deleteCompanyWorkspace('Olten')).resolves.toEqual(workspace);
  });

  it('protects a company recreated with the same name but a different ID', async () => {
    database.company.findUnique.mockResolvedValueOnce(workspace).mockResolvedValueOnce({ ...workspace, id: 'new-company' });
    await expect(service.deleteCompanyWorkspace('Olten')).rejects.toMatchObject({ status: 409 });
    expect(database.document.deleteMany).not.toHaveBeenCalled();
    expect(database.searchHistory.deleteMany).not.toHaveBeenCalled();
    expect(database.company.delete).not.toHaveBeenCalled();
  });

  it('reports retryable database failure after Drive deletion and succeeds on retry', async () => {
    database.company.delete.mockRejectedValueOnce({ code: 'P1001', message: 'Private database address' });
    await expect(service.deleteCompanyWorkspace('Olten')).rejects.toThrow('The Drive folder was removed, but database cleanup failed');
    expect(gemini.deleteGeminiFile).not.toHaveBeenCalled();
    await expect(service.deleteCompanyWorkspace('Olten')).resolves.toEqual(workspace);
    expect(drive.deleteCompanyFolder).toHaveBeenCalledTimes(2);
  });

  it('waits for an ongoing folder write and refuses new uploads/replacements until deletion completes', async () => {
    let finish!: (value: unknown) => void;
    drive.createSubFolder.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const write = service.createFolder('Olten', 'Existing folder');
    const deletion = service.deleteCompanyWorkspace('Olten');
    await Promise.resolve();
    expect(drive.deleteCompanyFolder).not.toHaveBeenCalled();
    await expect(service.createFolder('Olten', 'Late folder')).rejects.toMatchObject({ status: 409 });
    await expect(service.processNewDocument({}, 'Olten', 'admin')).rejects.toMatchObject({ status: 409 });
    await expect(service.replaceDocument(1, {}, 'Olten', 'admin')).rejects.toMatchObject({ status: 409 });
    finish({ id: 'finished-folder' });
    await write;
    await expect(deletion).resolves.toEqual(workspace);
    expect(drive.deleteCompanyFolder.mock.invocationCallOrder[0]).toBeGreaterThan(drive.createSubFolder.mock.invocationCallOrder[0]);
  });

  it('shares concurrent deletes of the same company without repeating remote deletion', async () => {
    const [first, second] = await Promise.all([service.deleteCompanyWorkspace('Olten'), service.deleteCompanyWorkspace('Olten')]);
    expect(first).toEqual(workspace);
    expect(second).toEqual(workspace);
    expect(drive.deleteCompanyFolder).toHaveBeenCalledTimes(1);
    expect(database.company.delete).toHaveBeenCalledTimes(1);
  });

  it('rejects slow multipart uploads after deletion, before any indexing or folder recreation', async () => {
    await service.deleteCompanyWorkspace('Olten');
    database.company.findUnique.mockResolvedValue(null);
    await expect(service.processNewDocument({}, 'Olten', 'admin')).rejects.toMatchObject({ status: 404 });
    await expect(service.replaceDocument(1, {}, 'Olten', 'admin')).rejects.toMatchObject({ status: 404 });
    await expect(service.createFolder('Olten', 'Late folder')).rejects.toMatchObject({ status: 404 });
    expect(drive.createSubFolder).not.toHaveBeenCalled();
  });

  it('allows new writes only after the same-name workspace has a new company ID', async () => {
    await service.deleteCompanyWorkspace('Olten');
    await expect(service.createFolder('Olten', 'Late folder')).rejects.toMatchObject({ status: 404 });
    database.company.findUnique.mockResolvedValue({ ...workspace, id: 'recreated-company' });
    await expect(service.createFolder('Olten', 'New folder')).resolves.toEqual({ id: 'existing-upload-folder' });
    expect(drive.createSubFolder).toHaveBeenCalledTimes(1);
  });

  it('does not accept a delayed upload permission check after the recreated company is also deleted', async () => {
    await service.deleteCompanyWorkspace('Olten');
    let finishCheck!: (value: unknown) => void;
    database.company.findUnique.mockImplementationOnce(() => new Promise(resolve => { finishCheck = resolve; }));
    const late = service.createFolder('Olten', 'Late folder');
    database.company.findUnique.mockResolvedValue({ ...workspace, id: 'recreated-company' });
    await service.deleteCompanyWorkspace('Olten');
    finishCheck({ id: 'recreated-company' });
    await expect(late).rejects.toMatchObject({ status: 409 });
    expect(drive.createSubFolder).not.toHaveBeenCalled();
  });

  it('does not delay success while Gemini index cleanup is slow or fails', async () => {
    let finishCleanup!: () => void;
    gemini.deleteGeminiFile.mockImplementationOnce(() => new Promise<void>(resolve => { finishCleanup = resolve; }));
    await expect(service.deleteCompanyWorkspace('Olten')).resolves.toEqual(workspace);
    finishCleanup();
    gemini.deleteGeminiFile.mockRejectedValueOnce(new Error('Gemini offline'));
    await expect(service.deleteCompanyWorkspace('Olten')).resolves.toEqual(workspace);
  });
});

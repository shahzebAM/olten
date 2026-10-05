jest.mock('googleapis', () => ({ google: {
  auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn() })) },
  drive: jest.fn(),
} }));
jest.mock('dotenv', () => ({ config: jest.fn() }));

import { google } from 'googleapis';
import { DriveService } from './drive.service';
import { Readable } from 'stream';

describe('Drive upload folder coordination and deletion', () => {
  let service: DriveService;
  let files: any;
  const previousRoot = process.env.GOOGLE_DRIVE_FOLDER_ID;

  beforeEach(() => {
    process.env.GOOGLE_DRIVE_FOLDER_ID = 'test-root';
    files = {
      list: jest.fn(async () => ({ data: { files: [] } })),
      create: jest.fn(async () => ({ data: { id: 'company-folder' } })),
      delete: jest.fn(async () => undefined),
      get: jest.fn(),
    };
    (google.drive as unknown as jest.Mock).mockReturnValue({ files });
    service = new DriveService();
  });

  afterAll(() => {
    if (previousRoot === undefined) delete process.env.GOOGLE_DRIVE_FOLDER_ID;
    else process.env.GOOGLE_DRIVE_FOLDER_ID = previousRoot;
  });

  it('shares concurrent company lookups and creates one root folder', async () => {
    expect(await Promise.all([service.getOrCreateCompanyFolder('Olten'), service.getOrCreateCompanyFolder('Olten')]))
      .toEqual(['company-folder', 'company-folder']);
    expect(files.list).toHaveBeenCalledTimes(1);
    expect(files.create).toHaveBeenCalledTimes(1);
  });

  it('refreshes completed or failed folder lookups on the next request', async () => {
    files.list.mockRejectedValueOnce(new Error('Drive unavailable'));
    const results = await Promise.allSettled([service.getOrCreateCompanyFolder('Olten'), service.getOrCreateCompanyFolder('Olten')]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    await expect(service.getOrCreateCompanyFolder('Olten')).resolves.toBe('company-folder');
    files.list.mockResolvedValue({ data: { files: [{ id: 'replacement-folder' }] } });
    await expect(service.getOrCreateCompanyFolder('Olten')).resolves.toBe('replacement-folder');
    expect(files.list).toHaveBeenCalledTimes(3);
  });

  it('shares concurrent directory scans, isolates callers and refreshes after completion', async () => {
    const source = { id: 'source', name: 'permit.pdf', mimeType: 'application/pdf', parents: ['company-folder'] };
    files.list.mockImplementation(async ({ q }) => ({ data: { files: q.startsWith('name =')
      ? [{ id: 'company-folder' }] : [source] } }));
    const [first, second] = await Promise.all([service.getCompanyDirectory('Olten'), service.getCompanyDirectory('Olten')]);
    expect(files.list).toHaveBeenCalledTimes(2);
    first.files[0].name = 'caller-edited.pdf';
    first.files[0].parents.push('caller-folder');
    first.files.push({ id: 'caller-only' });
    expect(second.files).toEqual([source]);
    source.name = 'externally-renamed.pdf';
    const fresh = await service.getCompanyDirectory('Olten');
    expect(files.list).toHaveBeenCalledTimes(4);
    expect(fresh.files[0].name).toBe('externally-renamed.pdf');
  });

  it('keeps concurrent directory scans separate between companies', async () => {
    files.list.mockImplementation(async ({ q }) => ({ data: { files: q.startsWith('name =')
      ? [{ id: q.includes("'Olten'") ? 'olten-folder' : 'surgicom-folder' }]
      : [{ id: q.includes('olten-folder') ? 'olten-source' : 'surgicom-source', mimeType: 'application/pdf' }] } }));
    const [olten, surgicom] = await Promise.all([service.getCompanyDirectory('Olten'), service.getCompanyDirectory('Surgicom')]);
    expect(files.list).toHaveBeenCalledTimes(4);
    expect(olten.files[0].id).toBe('olten-source');
    expect(surgicom.files[0].id).toBe('surgicom-source');
  });

  it('retries a failed shared directory scan on the next call', async () => {
    let fail = true;
    files.list.mockImplementation(async ({ q }) => {
      if (q.startsWith('name =')) return { data: { files: [{ id: 'company-folder' }] } };
      if (fail) throw new Error('Directory unavailable');
      return { data: { files: [] } };
    });
    const failures = await Promise.allSettled([service.getCompanyDirectory('Olten'), service.getCompanyDirectory('Olten')]);
    expect(failures.every(result => result.status === 'rejected')).toBe(true);
    expect(files.list).toHaveBeenCalledTimes(2);
    fail = false;
    await expect(service.getCompanyDirectory('Olten')).resolves.toMatchObject({ files: [] });
    expect(files.list).toHaveBeenCalledTimes(4);
  });

  it('does not join an older directory scan after a completed deletion', async () => {
    let resolveOld!: (value: unknown) => void;
    let oldScanStarted!: () => void;
    const started = new Promise<void>(resolve => { oldScanStarted = resolve; });
    let scans = 0;
    files.list.mockImplementation(async ({ q }) => {
      if (q.startsWith('name =')) return { data: { files: [{ id: 'company-folder' }] } };
      scans += 1;
      if (scans === 1) {
        oldScanStarted();
        return new Promise(resolve => { resolveOld = resolve; });
      }
      return { data: { files: [] } };
    });
    const old = service.getCompanyDirectory('Olten');
    await started;
    await service.deleteFile('deleted-source');
    const fresh = await service.getCompanyDirectory('Olten');
    expect(fresh.files).toEqual([]);
    expect(scans).toBe(2);
    resolveOld({ data: { files: [{ id: 'deleted-source', mimeType: 'application/pdf' }] } });
    await old;
    expect(fresh.files).toEqual([]);
  });

  it('reports Drive deletion failures instead of claiming success', async () => {
    files.delete.mockRejectedValue({ code: 403, message: 'Permission denied' });
    await expect(service.deleteFile('source-id')).rejects.toThrow('Google Drive could not delete');
  });

  it('allows idempotent deletion when the Drive source is already gone', async () => {
    files.delete.mockRejectedValue({ response: { status: 404 }, message: 'Not found' });
    await expect(service.deleteFile('source-id')).resolves.toBeUndefined();
  });

  it('deletes only the supplied exact Drive ID', async () => {
    await service.deleteFile('specific-source');
    expect(files.delete).toHaveBeenCalledWith({ fileId: 'specific-source', supportsAllDrives: true });
  });

  it('escapes company names in the Drive query so quotes cannot change folder scope', async () => {
    await service.getOrCreateCompanyFolder("O'Neil\\Branch");
    expect(files.list.mock.calls[0][0].q).toBe("name = 'O\\'Neil\\\\Branch' and 'test-root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  });

  it('streams original bytes without buffering or using a Google viewer page', async () => {
    const stream = Readable.from(Buffer.from('%PDF-1.7'));
    files.get.mockResolvedValueOnce({ data: { name: 'license.pdf', mimeType: 'application/pdf', size: '8' } });
    files.get.mockResolvedValueOnce({ data: stream });
    const result = await service.downloadFileStream('exact-source');
    expect(result).toEqual({ stream, name: 'license.pdf', mimeType: 'application/pdf', size: 8 });
    expect(result.stream).toBe(stream);
    expect(files.get).toHaveBeenNthCalledWith(2, { fileId: 'exact-source', alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
    stream.destroy();
  });

  it.each(['text/html', 'image/svg+xml', 'application/javascript'])('rejects active %s content before fetching bytes', async mimeType => {
    files.get.mockResolvedValueOnce({ data: { name: 'unsafe', mimeType } });
    await expect(service.downloadFileStream('unsafe-source')).rejects.toMatchObject({ status: 415 });
    expect(files.get).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed source IDs without calling Drive', async () => {
    await expect(service.downloadFileStream('../other-company')).rejects.toMatchObject({ status: 400 });
    expect(files.get).not.toHaveBeenCalled();
  });

  it('rejects oversized previews before downloading to keep memory bounded', async () => {
    files.get.mockResolvedValueOnce({ data: { mimeType: 'application/pdf', size: String(100 * 1024 * 1024 + 1) } });
    await expect(service.downloadFileStream('large-source')).rejects.toMatchObject({ status: 413 });
    expect(files.get).toHaveBeenCalledTimes(1);
  });

  it('treats trashed or missing originals as unavailable', async () => {
    files.get.mockResolvedValueOnce({ data: { trashed: true, mimeType: 'application/pdf' } });
    await expect(service.downloadFileStream('trashed-source')).rejects.toMatchObject({ status: 404 });
    expect(files.get).toHaveBeenCalledTimes(1);
    files.get.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(service.downloadFileStream('missing-source')).rejects.toMatchObject({ status: 404 });
  });

  it('does not expose Google account details in download errors', async () => {
    files.get.mockRejectedValueOnce({ code: 403, message: 'Private OAuth account details' });
    await expect(service.downloadFileStream('denied-source')).rejects.toThrow('The document could not be loaded. Please retry.');
  });
});

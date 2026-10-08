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

  it('deletes all matching company roots across pages before committing, without scanning descendants', async () => {
    const company = "O'Neil\\Branch";
    files.list.mockResolvedValueOnce({ data: { files: [{ id: 'first-folder' }], nextPageToken: 'page-two' } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'second-folder' }, { id: 'first-folder' }] } });
    files.get.mockResolvedValue({ data: { name: company, mimeType: 'application/vnd.google-apps.folder', parents: ['test-root'] } });
    const commit = jest.fn(async () => ({ name: company }));
    await expect(service.deleteCompanyFolder(company, commit)).resolves.toEqual({ name: company });
    expect(files.list).toHaveBeenCalledTimes(2);
    expect(files.list.mock.calls[0][0].q).toBe("name = 'O\\'Neil\\\\Branch' and 'test-root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    expect(files.list.mock.calls[1][0].pageToken).toBe('page-two');
    expect(files.delete.mock.calls).toEqual([
      [{ fileId: 'first-folder', supportsAllDrives: true }], [{ fileId: 'second-folder', supportsAllDrives: true }],
    ]);
    expect(commit.mock.invocationCallOrder[0]).toBeGreaterThan(files.delete.mock.invocationCallOrder[1]);
    expect(files.create).not.toHaveBeenCalled();
  });

  it('commits company deletion when its folder is already absent without creating an empty one', async () => {
    const commit = jest.fn(async () => 'deleted');
    await expect(service.deleteCompanyFolder('Olten', commit)).resolves.toBe('deleted');
    expect(files.create).not.toHaveBeenCalled();
    expect(files.delete).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'Other Company', mimeType: 'application/vnd.google-apps.folder', parents: ['test-root'] },
    { name: 'Olten', mimeType: 'application/vnd.google-apps.folder', parents: ['outside-root'] },
    { name: 'Olten', mimeType: 'application/pdf', parents: ['test-root'] },
    { name: 'Olten', mimeType: 'application/vnd.google-apps.folder', parents: ['test-root', 'outside-root'] },
  ])('refuses a company root whose fresh metadata changed: %j', async metadata => {
    files.list.mockResolvedValue({ data: { files: [{ id: 'changed-folder' }] } });
    files.get.mockResolvedValue({ data: metadata });
    const commit = jest.fn(async () => undefined);
    await expect(service.deleteCompanyFolder('Olten', commit)).rejects.toMatchObject({ status: 409 });
    expect(files.delete).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it.each(['test-root', "invalid'folder"])('never deletes the configured root or invalid folder ID %s', async id => {
    files.list.mockResolvedValue({ data: { files: [{ id }] } });
    const commit = jest.fn(async () => undefined);
    await expect(service.deleteCompanyFolder('Olten', commit)).rejects.toMatchObject({ status: 502 });
    expect(files.get).not.toHaveBeenCalled();
    expect(files.delete).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects incomplete lookups before deleting any folder or database company', async () => {
    files.list.mockResolvedValue({ data: { incompleteSearch: true, files: [{ id: 'company-folder' }] } });
    const commit = jest.fn(async () => undefined);
    await expect(service.deleteCompanyFolder('Olten', commit)).rejects.toMatchObject({ status: 502 });
    expect(files.delete).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not reveal OAuth details or commit when the root lookup fails', async () => {
    files.list.mockRejectedValue({ code: 403, message: 'Private OAuth account details' });
    const commit = jest.fn(async () => undefined);
    await expect(service.deleteCompanyFolder('Olten', commit)).rejects.toThrow('Google Drive could not find the workspace folder');
    expect(commit).not.toHaveBeenCalled();
  });

  it('allows idempotent deletion if a listed folder disappears before metadata verification', async () => {
    files.list.mockResolvedValue({ data: { files: [{ id: 'missing-folder' }] } });
    files.get.mockRejectedValue({ response: { status: 404 } });
    const commit = jest.fn(async () => undefined);
    await service.deleteCompanyFolder('Olten', commit);
    expect(files.delete).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('keeps the database company when Google refuses folder deletion and allows a retry', async () => {
    files.list.mockResolvedValue({ data: { files: [{ id: 'company-folder' }] } });
    files.get.mockResolvedValue({ data: { name: 'Olten', mimeType: 'application/vnd.google-apps.folder', parents: ['test-root'] } });
    files.delete.mockRejectedValueOnce({ code: 403, message: 'No permission' });
    const commit = jest.fn(async () => undefined);
    await expect(service.deleteCompanyFolder('Olten', commit)).rejects.toMatchObject({ status: 502 });
    expect(commit).not.toHaveBeenCalled();
    await service.deleteCompanyFolder('Olten', commit);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('blocks new company storage creation until database deletion has completed', async () => {
    let release!: () => void;
    let started!: () => void;
    const callbackStarted = new Promise<void>(resolve => { started = resolve; });
    const complete = new Promise<void>(resolve => { release = resolve; });
    const deletion = service.deleteCompanyFolder('Olten', async () => { started(); await complete; });
    await callbackStarted;
    await expect(service.getOrCreateCompanyFolder('Olten')).rejects.toMatchObject({ status: 409 });
    await expect(service.createSubFolder('Olten', 'Late folder', 'old-parent')).rejects.toMatchObject({ status: 409 });
    await expect(service.uploadFileToDrive(Buffer.from('PDF'), 'application/pdf', 'late.pdf', 'Olten', 'old-parent'))
      .rejects.toMatchObject({ status: 409 });
    expect(files.create).not.toHaveBeenCalled();
    release();
    await deletion;
    await expect(service.getOrCreateCompanyFolder('Another Company')).resolves.toBe('company-folder');
  });

  it('waits for a company root creation already in flight before looking up folders to delete', async () => {
    let finishLookup!: (result: any) => void;
    files.list.mockImplementationOnce(() => new Promise(resolve => { finishLookup = resolve; }))
      .mockResolvedValue({ data: { files: [{ id: 'company-folder' }] } });
    files.get.mockResolvedValue({ data: { name: 'Olten', mimeType: 'application/vnd.google-apps.folder', parents: ['test-root'] } });
    const creation = service.getOrCreateCompanyFolder('Olten');
    const commit = jest.fn(async () => undefined);
    const deletion = service.deleteCompanyFolder('Olten', commit);
    expect(files.list).toHaveBeenCalledTimes(1);
    finishLookup({ data: { files: [] } });
    await creation;
    await deletion;
    expect(files.create).toHaveBeenCalledTimes(1);
    expect(files.delete.mock.invocationCallOrder[0]).toBeGreaterThan(files.create.mock.invocationCallOrder[0]);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not let a delayed directory request recreate a deleted company folder', async () => {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const oldRequest = (async () => { await delayed; return service.getCompanyDirectory('Olten'); })();
    await service.deleteCompanyFolder('Olten', async () => undefined);
    release();
    await expect(oldRequest).rejects.toMatchObject({ status: 404 });
    await expect(service.uploadFileToDrive(Buffer.from('PDF'), 'application/pdf', 'late.pdf', 'Olten', 'old-parent'))
      .rejects.toMatchObject({ status: 404 });
    expect(files.create).not.toHaveBeenCalled();
    expect(files.list).toHaveBeenCalledTimes(1);
  });

  it('allows folder creation for a newly recreated company after confirming its new database identity', async () => {
    let recreated = false;
    const isRecreated = jest.fn(async () => recreated);
    await service.deleteCompanyFolder('Olten', async () => undefined, isRecreated);
    await expect(service.getOrCreateCompanyFolder('Olten')).rejects.toMatchObject({ status: 404 });
    recreated = true;
    await expect(service.getOrCreateCompanyFolder('Olten')).resolves.toBe('company-folder');
    expect(isRecreated).toHaveBeenCalledTimes(2);
    expect(files.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a delayed recreation check if a newer company deletion has completed meanwhile', async () => {
    let finishCheck!: (value: boolean) => void;
    await service.deleteCompanyFolder('Olten', async () => undefined,
      () => new Promise(resolve => { finishCheck = resolve; }));
    const late = service.getOrCreateCompanyFolder('Olten');
    await service.deleteCompanyFolder('Olten', async () => undefined, async () => false);
    finishCheck(true);
    await expect(late).rejects.toMatchObject({ status: 409 });
    expect(files.create).not.toHaveBeenCalled();
  });

  it.each(['root', 'subfolder', 'upload'])('rechecks deletion after asynchronous company recreation verification for %s', async kind => {
    let finishCheck!: (value: boolean) => void;
    await service.deleteCompanyFolder('Olten', async () => undefined,
      () => new Promise(resolve => { finishCheck = resolve; }));
    const late = kind === 'root' ? service.getOrCreateCompanyFolder('Olten')
      : kind === 'subfolder' ? service.createSubFolder('Olten', 'Late folder', 'old-parent')
        : service.uploadFileToDrive(Buffer.from('PDF'), 'application/pdf', 'late.pdf', 'Olten', 'old-parent');
    let releaseLookup!: (value: unknown) => void;
    files.list.mockImplementationOnce(() => new Promise(resolve => { releaseLookup = resolve; }));
    let secondDeletion!: Promise<unknown>;
    finishCheck(true);
    queueMicrotask(() => { secondDeletion = service.deleteCompanyFolder('Olten', async () => undefined); });
    await expect(late).rejects.toMatchObject({ status: 409 });
    expect(files.create).not.toHaveBeenCalled();
    releaseLookup({ data: { files: [] } });
    await secondDeletion;
  });

  it('streams original bytes without buffering or using a Google viewer page', async () => {
    const stream = Readable.from(Buffer.from('%PDF-1.7'));
    files.get.mockResolvedValueOnce({ data: { name: 'license.pdf', mimeType: 'application/pdf', size: '8' } });
    files.get.mockResolvedValueOnce({ data: stream });
    const result = await service.downloadFileStream('exact-source');
    expect(result).toEqual({ stream, name: 'license.pdf', mimeType: 'application/pdf', size: 8, totalSize: 8 });
    expect(result.stream).toBe(stream);
    expect(files.get).toHaveBeenNthCalledWith(2, { fileId: 'exact-source', alt: 'media', supportsAllDrives: true }, { responseType: 'stream', headers: { 'Accept-Encoding': 'identity' } });
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

  const folder = (name: string, parent: string, overrides = {}) => ({
    name, mimeType: 'application/vnd.google-apps.folder', parents: [parent], trashed: false, ...overrides,
  });
  const source = (parent = 'company-folder', overrides = {}) => ({
    name: 'license.pdf', mimeType: 'application/pdf', size: '10', parents: [parent], trashed: false, ...overrides,
  });
  const mockAncestry = (entries: Record<string, any>) => {
    files.get.mockImplementation(async ({ fileId, alt }) => {
      if (alt === 'media') return { data: Readable.from(Buffer.from('0123456789')), status: 200 };
      if (!entries[fileId]) throw { code: 404 };
      return { data: entries[fileId] };
    });
  };

  it('loads direct company sources with two metadata calls and no directory scan or folder creation', async () => {
    mockAncestry({ file: source(), 'company-folder': folder('Olten', 'test-root') });
    const content = await service.downloadCompanyFileStream('file', 'Olten');
    expect(content).toMatchObject({ mimeType: 'application/pdf', size: 10, totalSize: 10 });
    expect(files.get.mock.calls.map(([options]) => options.fileId)).toEqual(['file', 'company-folder', 'file']);
    expect(files.list).not.toHaveBeenCalled();
    expect(files.create).not.toHaveBeenCalled();
    content.stream.destroy();
  });

  it('authorizes nested files by actual folder ancestry instead of names of unrelated folders', async () => {
    mockAncestry({ file: source('nested'), nested: folder('Permits', 'company-folder'),
      'company-folder': folder('Olten', 'test-root') });
    const content = await service.downloadCompanyFileStream('file', 'Olten');
    expect(files.get).toHaveBeenCalledTimes(4);
    expect(files.list).not.toHaveBeenCalled();
    content.stream.destroy();
  });

  it('returns fresh exact metadata for replacement without downloading or restricting analysis-supported types', async () => {
    const metadata: any = source('nested', { mimeType: 'text/plain', modifiedTime: '2026-10-06', md5Checksum: 'abc', version: '3' });
    mockAncestry({ file: metadata, nested: folder('Permits', 'company-folder'), 'company-folder': folder('Olten', 'test-root') });
    expect(await service.getCompanyFileMetadata('file', 'Olten')).toEqual(metadata);
    expect(files.get.mock.calls.some(([options]) => options.alt === 'media')).toBe(false);
    metadata.version = '4';
    expect(await service.getCompanyFileMetadata('file', 'Olten')).toMatchObject({ version: '4' });
    expect(files.get).toHaveBeenCalledTimes(6);
  });

  it('never treats a company folder as a replaceable document source', async () => {
    mockAncestry({ 'company-folder': folder('Olten', 'test-root') });
    await expect(service.getCompanyFileMetadata('company-folder', 'Olten')).rejects.toMatchObject({ status: 404 });
    expect(files.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    { file: source(), 'company-folder': folder('Other', 'test-root') },
    { file: source('nested'), nested: folder('Olten', 'other-root'), 'other-root': folder('Elsewhere', 'root') },
    { file: source(), 'company-folder': folder('Olten', 'test-root', { trashed: true }) },
    { file: source('nested'), nested: folder('Other', 'company-folder', { trashed: true }), 'company-folder': folder('Olten', 'test-root') },
    { file: source('nested'), nested: { name: 'Olten', mimeType: 'application/pdf', parents: ['test-root'] } },
    { file: source('test-root', { name: 'Olten' }) },
    { file: source('company-folder', { trashed: true }), 'company-folder': folder('Olten', 'test-root') },
    { file: source('company-folder', { parents: ['company-folder', 'other-folder'] }), 'company-folder': folder('Olten', 'test-root') },
    { file: source('cycle'), cycle: folder('Cycle', 'cycle') },
  ])('rejects moved, trashed, malformed or ambiguous ancestry without downloading: %j', async entries => {
    mockAncestry(entries);
    await expect(service.downloadCompanyFileStream('file', 'Olten')).rejects.toMatchObject({ status: 404 });
    expect(files.get.mock.calls.some(([options]) => options.alt === 'media')).toBe(false);
  });

  it('rechecks ownership on each request so moving a previously opened file revokes its preview', async () => {
    const entries = { file: source(), 'company-folder': folder('Olten', 'test-root') };
    mockAncestry(entries);
    (await service.downloadCompanyFileStream('file', 'Olten')).stream.destroy();
    entries['company-folder'].name = 'Other';
    await expect(service.downloadCompanyFileStream('file', 'Olten')).rejects.toMatchObject({ status: 404 });
    expect(files.get.mock.calls.filter(([options]) => options.alt === 'media')).toHaveLength(1);
  });

  it('bounds malformed deep ancestries instead of looping indefinitely', async () => {
    const entries: Record<string, any> = { file: source('folder-0') };
    for (let depth = 0; depth < 70; depth += 1) entries[`folder-${depth}`] = folder('Nested', `folder-${depth + 1}`);
    mockAncestry(entries);
    await expect(service.downloadCompanyFileStream('file', 'Olten')).rejects.toMatchObject({ status: 404 });
    expect(files.get).toHaveBeenCalledTimes(65);
  });

  it.each([
    ['bytes=0-3', 'bytes=0-3', 'bytes 0-3/10', 4],
    ['bytes=7-', 'bytes=7-9', 'bytes 7-9/10', 3],
    ['bytes=-3', 'bytes=7-9', 'bytes 7-9/10', 3],
    ['bytes=-30', 'bytes=0-9', 'bytes 0-9/10', 10],
    ['bytes=4-100', 'bytes=4-9', 'bytes 4-9/10', 6],
  ])('streams a validated single %s range with truthful partial lengths', async (input, normalized, contentRange, size) => {
    const stream = Readable.from(Buffer.from('partial'));
    files.get.mockResolvedValueOnce({ data: source() }).mockResolvedValueOnce({ data: stream, status: 206,
      headers: { 'content-range': contentRange, 'content-length': String(size) } });
    const content = await service.downloadFileStream('file', input as string);
    expect(content).toMatchObject({ size, totalSize: 10, statusCode: 206, contentRange });
    expect(files.get.mock.calls[1][1]).toEqual({ responseType: 'stream', headers: { 'Accept-Encoding': 'identity', Range: normalized } });
    stream.destroy();
  });

  it.each(['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=', 'items=0-2', 'bytes=0-1,4-5', 'bytes=9007199254740992-'])
    ('rejects unsatisfiable or unsupported %s ranges before requesting bytes', async range => {
      files.get.mockResolvedValueOnce({ data: source() });
      await expect(service.downloadFileStream('file', range)).rejects.toMatchObject({ status: 416, totalSize: 10 });
      expect(files.get).toHaveBeenCalledTimes(1);
    });

  it('returns a full 200-sized stream if Drive ignores a supported range', async () => {
    files.get.mockResolvedValueOnce({ data: source() }).mockResolvedValueOnce({ data: Readable.from(Buffer.from('0123456789')),
      status: 200, headers: { 'content-length': '10' } });
    const result = await service.downloadFileStream('file', 'bytes=0-3');
    expect(result).toMatchObject({ size: 10, totalSize: 10 });
    expect(result.statusCode).toBeUndefined();
    expect(result.contentRange).toBeUndefined();
    result.stream.destroy();
  });

  it('destroys an inconsistent upstream slice instead of mislabeling or mixing changed content', async () => {
    const stream = Readable.from(Buffer.from('partial'));
    files.get.mockResolvedValueOnce({ data: source() }).mockResolvedValueOnce({ data: stream, status: 206,
      headers: { 'content-range': 'bytes 0-3/12', 'content-length': '4' } });
    await expect(service.downloadFileStream('file', 'bytes=0-3')).rejects.toThrow('changed while loading');
    expect(stream.destroyed).toBe(true);
  });

  it('uses a fresh stable validator and returns full content when If-Range no longer matches', async () => {
    mockAncestry({ file: source('company-folder', { md5Checksum: 'content-v1', version: '1' }),
      'company-folder': folder('Olten', 'test-root') });
    const first = await service.downloadCompanyFileStream('file', 'Olten');
    expect(first.etag).toMatch(/^"[a-f0-9]{64}"$/);
    first.stream.destroy();
    const next = await service.downloadCompanyFileStream('file', 'Olten', 'bytes=0-3', '"old-version"');
    expect(next.statusCode).toBeUndefined();
    expect(files.get.mock.calls.at(-1)?.[1]).toEqual({ responseType: 'stream', headers: { 'Accept-Encoding': 'identity' } });
    next.stream.destroy();
  });
});

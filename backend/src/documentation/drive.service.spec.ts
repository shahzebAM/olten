jest.mock('googleapis', () => ({ google: {
  auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn() })) },
  drive: jest.fn(),
} }));
jest.mock('dotenv', () => ({ config: jest.fn() }));

import { google } from 'googleapis';
import { DriveService } from './drive.service';

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
});

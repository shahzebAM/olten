jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn() }));
jest.mock('./gemini.service', () => ({ GeminiService: jest.fn() }));
jest.mock('./drive.service', () => ({ DriveService: jest.fn() }));

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { DocumentService } from './document.service';
import { ExpiryExtractorService } from './expiry-extractor.service';

const prisma = (PrismaClient as unknown as jest.Mock).mock.instances[0];
const date = (day: string) => new Date(`${day}T00:00:00.000Z`);

describe('staged document replacement', () => {
  const file = { originalname: 'renewed.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7 renewed document') };
  const newLink = 'https://drive.google.com/file/d/new-source/view';
  let service: DocumentService;
  let row: any;
  let reminders: any[];
  let notifications: any[];
  let oldMetadata: any;
  let newMetadata: any;
  let gemini: any;
  let drive: any;
  let version: number;
  const replacement = () => service.replaceDocument(42, file, 'Olten', 'signed-user', 'old-source');

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-06T04:00:00.000Z'));
    version = 0;
    row = { id: 42, company: 'Olten', status: 'ACTIVE', filename: 'permit.pdf', originalName: 'permit.pdf',
      mimeType: 'application/pdf', sizeBytes: 200, googleDriveLink: 'https://drive.google.com/file/d/old-source/view',
      updatedAt: date('2026-10-05'), uploadedBy: 'old-user', expiryDate: date('2026-10-12'),
      expiryStatus: 'EXPIRING_SOON', expiryConfidence: 0.95, expiryDetectionMethod: 'GEMINI',
      geminiFileId: 'files/old-index', geminiFileUri: 'uri/old-index' };
    reminders = [{ id: 9, documentId: 42, company: 'Olten', fileName: 'permit.pdf', status: 'FULFILLED',
      reminderType: 'MANUAL_MONTHS_2', reminderDays: 61, expiryDate: date('2026-10-12'), triggerDate: date('2026-08-12') }];
    notifications = [{ id: 7, company: 'Olten', documentId: 42 }];
    oldMetadata = { id: 'old-source', name: 'permit.pdf', mimeType: 'application/pdf', size: '200',
      parents: ['nested-company-folder'], modifiedTime: '2026-10-05T00:00:00Z', version: '1', md5Checksum: 'old-md5' };
    newMetadata = { id: 'new-source', name: file.originalname, mimeType: file.mimetype, size: String(file.buffer.length),
      parents: ['nested-company-folder'], modifiedTime: '2026-10-06T04:00:00Z', version: '1',
      md5Checksum: createHash('md5').update(file.buffer).digest('hex') };
    const matches = (where: any) => Object.entries(where).every(([key, value]) => value === undefined
      || (value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value));
    prisma.document = {
      findFirst: jest.fn(async ({ where }) => matches(where) ? { ...row } : null),
      findMany: jest.fn(async () => []),
      create: jest.fn(),
      update: jest.fn(async ({ where, data }) => {
        if (!matches(where)) throw Object.assign(new Error('Source changed'), { code: 'P2025' });
        row = { ...row, ...data, updatedAt: new Date(date('2026-10-06').getTime() + ++version * 1000) };
        return { ...row };
      }),
    };
    prisma.documentReminder = {
      findMany: jest.fn(async () => structuredClone(reminders)),
      findUnique: jest.fn(async ({ where }) => reminders.find(rem => rem.reminderType === where.documentId_reminderType.reminderType) || null),
      deleteMany: jest.fn(async ({ where }) => {
        const before = reminders.length;
        reminders = where.OR ? reminders.filter(rem => rem.reminderType === where.OR[0].reminderType.not) : [];
        return { count: before - reminders.length };
      }),
      upsert: jest.fn(async ({ create, update, where }) => {
        const previous = reminders.find(rem => rem.reminderType === where.documentId_reminderType.reminderType);
        const saved = previous ? { ...previous, ...update } : { id: 10, ...create };
        reminders = [saved];
        return { ...saved };
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const sourceMatches = !where.document || where.document.OR.some(candidate => candidate.id === row.id
          && candidate.googleDriveLink === row.googleDriveLink) && row.company === where.document.company && row.status === 'ACTIVE';
        let count = 0;
        reminders = reminders.map(rem => {
          if (!sourceMatches || rem.id !== where.id || rem.company !== where.company
            || where.expiryDate && rem.expiryDate.getTime() !== where.expiryDate.getTime()) return rem;
          count += 1;
          return { ...rem, ...data };
        });
        return { count };
      }),
    };
    prisma.expiryNotification = { deleteMany: jest.fn(async () => { notifications = []; return { count: 1 }; }) };
    prisma.$transaction = jest.fn(async callback => {
      const snapshot = structuredClone({ row, reminders, notifications });
      try { return await callback(prisma); }
      catch (error) { ({ row, reminders, notifications } = snapshot); throw error; }
    });
    gemini = {
      normalizeMimeType: jest.fn(() => 'application/pdf'),
      uploadFileToGemini: jest.fn(async () => ({ fileId: 'files/new-index', fileUri: 'uri/new-index', mimeType: 'application/pdf' })),
      deleteGeminiFile: jest.fn(async () => undefined),
      extractStructuredExpiry: jest.fn(async () => ({ documentType: 'License', documentNumber: 'NEW-42',
        issueDate: date('2026-10-06'), expiryDate: date('2027-12-31'), renewalDate: null,
        renewalDaysBeforeExpiry: null, expiryDateText: 'Valid until 31 December 2027', confidence: 0.95, method: 'GEMINI' })),
    };
    drive = {
      getCompanyFileMetadata: jest.fn(async (id, company) => {
        if (company !== 'Olten') throw new Error('Wrong company');
        return structuredClone(id === 'old-source' ? oldMetadata : newMetadata);
      }),
      uploadFileToDrive: jest.fn(async () => newLink),
      deleteFile: jest.fn(async () => undefined),
    };
    service = new DocumentService(gemini, drive, new ExpiryExtractorService());
    (service as any).searchAnswers.set('old-answer', { company: 'Olten', expiresAt: Infinity, answer: { text: 'old' } });
  });

  afterEach(() => { jest.useRealTimers(); });

  it('keeps one document ID, saves the new exact source and resets its selected month schedule', async () => {
    const result = await replacement();
    expect(result).toMatchObject({ id: 42, driveFileId: 'new-source', sourceUrl: newLink,
      filename: 'renewed.pdf', originalName: 'renewed.pdf', mimeType: 'application/pdf', sizeBytes: file.buffer.length,
      uploadedBy: 'signed-user', geminiFileUri: 'uri/new-index', expiryDate: date('2027-12-31'),
      reminderDisabled: false, reminderSetupPending: false,
      reminderValue: 2, reminderUnit: 'months',
      reminder: { reminderType: 'MANUAL_MONTHS_2', triggerDate: date('2027-10-31'), status: 'PENDING' } });
    expect(result.updatedAt).toBeInstanceOf(Date);
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(prisma.document.update.mock.calls[0][0].where).toMatchObject({ id: 42, company: 'Olten', status: 'ACTIVE',
      googleDriveLink: 'https://drive.google.com/file/d/old-source/view', updatedAt: date('2026-10-05') });
    expect(drive.uploadFileToDrive).toHaveBeenCalledWith(file.buffer, 'application/pdf', 'renewed.pdf', 'Olten', 'nested-company-folder');
    expect(drive.deleteFile).toHaveBeenCalledWith('old-source');
    expect(gemini.deleteGeminiFile).toHaveBeenCalledWith('files/old-index');
    expect(notifications).toEqual([]);
    expect((service as any).searchAnswers.size).toBe(0);
    expect(drive.deleteFile.mock.invocationCallOrder[0]).toBeGreaterThan(prisma.documentReminder.upsert.mock.invocationCallOrder[0]);
  });

  it('passes the same Gemini indexing promise to expiry extraction instead of uploading twice', async () => {
    await replacement();
    expect(gemini.uploadFileToGemini).toHaveBeenCalledTimes(1);
    expect(gemini.extractStructuredExpiry).toHaveBeenCalledTimes(1);
    expect(gemini.extractStructuredExpiry.mock.calls[0][3]).toBe(gemini.uploadFileToGemini.mock.results[0].value);
  });

  it('preserves a chosen day lead even when the expiry is corrected to an earlier date', async () => {
    reminders[0] = { ...reminders[0], reminderType: 'MANUAL', reminderDays: 5 };
    gemini.extractStructuredExpiry.mockResolvedValue({ expiryDate: date('2026-10-10'), confidence: 0.95, method: 'GEMINI' });
    expect(await replacement()).toMatchObject({ expiryDate: date('2026-10-10'),
      reminder: { reminderDays: 5, triggerDate: date('2026-10-05'), status: 'PENDING', isTriggered: true } });
  });

  it.each(['REMINDER_DISABLED', 'REMINDER_DISABLED_REVIEW'])('keeps %s fully disabled with explicit null settings', async status => {
    row.expiryStatus = status;
    const result = await replacement();
    expect(result).toMatchObject({ reminderDisabled: true, reminderSetupPending: false,
      reminder: null, reminderValue: null, reminderUnit: null, reminderDays: null });
    expect(row.expiryStatus).toBe('REMINDER_DISABLED');
    expect(reminders).toEqual([]);
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it.each(['AWAITING_REMINDER', 'AWAITING_REMINDER_REVIEW'])('keeps %s pending without activating an alert', async status => {
    row.expiryStatus = status;
    expect(await replacement()).toMatchObject({ reminderSetupPending: true, reminderDisabled: false,
      reminder: null, reminderValue: null, reminderUnit: null });
    expect(row.expiryStatus).toBe('AWAITING_REMINDER');
    expect(reminders).toEqual([]);
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('does not invent a 30-day schedule when the previous source has no chosen reminder', async () => {
    reminders = [];
    expect(await replacement()).toMatchObject({ reminderSetupPending: true, reminder: null, reminderValue: null });
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it.each([null, { expiryDate: date('2027-12-31'), confidence: 0.84 },
    { expiryDate: date('2027-12-31'), confidence: Number.NaN }])('preserves all old data and removes staging for an unreliable expiry %j', async analysis => {
    const original = structuredClone({ row, reminders, notifications });
    gemini.extractStructuredExpiry.mockResolvedValue(analysis);
    await expect(replacement()).rejects.toThrow('reliable expiry date');
    expect({ row, reminders, notifications }).toEqual(original);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(drive.deleteFile.mock.calls).toEqual([['new-source']]);
    expect(gemini.deleteGeminiFile.mock.calls).toEqual([['files/new-index']]);
    expect((service as any).searchAnswers.size).toBe(1);
  });

  it('removes its staged Drive file when search indexing fails', async () => {
    gemini.uploadFileToGemini.mockRejectedValue(new Error('Gemini unavailable'));
    await expect(replacement()).rejects.toThrow('indexed for search');
    expect(row.googleDriveLink).toContain('old-source');
    expect(drive.deleteFile.mock.calls).toEqual([['new-source']]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(gemini.deleteGeminiFile).not.toHaveBeenCalled();
  });

  it('removes its staged Gemini index when Drive upload fails', async () => {
    drive.uploadFileToDrive.mockRejectedValue(new Error('Drive unavailable'));
    await expect(replacement()).rejects.toThrow('original document was preserved');
    expect(gemini.deleteGeminiFile.mock.calls).toEqual([['files/new-index']]);
    expect(drive.deleteFile).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects inactive, foreign-company and stale selected sources before uploading', async () => {
    row.status = 'DELETED';
    await expect(replacement()).rejects.toThrow('not found in this company');
    row.status = 'ACTIVE';
    await expect(service.replaceDocument(42, file, 'Other', 'signed-user')).rejects.toThrow('not found in this company');
    await expect(service.replaceDocument(42, file, 'Olten', 'signed-user', 'other-source')).rejects.toMatchObject({ status: 409 });
    expect(drive.uploadFileToDrive).not.toHaveBeenCalled();
    expect(gemini.extractStructuredExpiry).not.toHaveBeenCalled();
    expect(drive.getCompanyFileMetadata).not.toHaveBeenCalled();
  });

  it('preserves a reminder disabled while replacement analysis is still running', async () => {
    gemini.extractStructuredExpiry.mockImplementation(async () => {
      row.expiryStatus = 'REMINDER_DISABLED';
      row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
      reminders = [];
      return { expiryDate: date('2027-12-31'), confidence: 0.95, method: 'GEMINI' };
    });
    await expect(replacement()).rejects.toMatchObject({ status: 409 });
    expect(row.googleDriveLink).toContain('old-source');
    expect(row.expiryStatus).toBe('REMINDER_DISABLED');
    expect(reminders).toEqual([]);
    expect(drive.deleteFile.mock.calls).toEqual([['new-source']]);
  });

  it('tolerates cron-only timestamp and display-status normalization during a long analysis', async () => {
    gemini.extractStructuredExpiry.mockImplementation(async () => {
      row.updatedAt = new Date(row.updatedAt.getTime() + 60000);
      row.lastExpiryCheck = new Date();
      row.expiryStatus = 'ACTIVE';
      return { expiryDate: date('2027-12-31'), confidence: 0.95, method: 'GEMINI' };
    });
    expect(await replacement()).toMatchObject({ id: 42, driveFileId: 'new-source',
      reminder: { reminderType: 'MANUAL_MONTHS_2', status: 'PENDING' } });
    expect(prisma.document.update.mock.calls[0][0].where.updatedAt).toEqual(new Date(date('2026-10-05').getTime() + 60000));
  });

  it('preserves the latest chosen lead time when the user edits it while analysis is running', async () => {
    gemini.extractStructuredExpiry.mockImplementation(async () => {
      row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
      reminders[0] = { ...reminders[0], reminderType: 'MANUAL', reminderDays: 7 };
      return { expiryDate: date('2027-12-31'), confidence: 0.95, method: 'GEMINI' };
    });
    expect(await replacement()).toMatchObject({ id: 42, driveFileId: 'new-source',
      reminder: { reminderType: 'MANUAL', reminderDays: 7, triggerDate: date('2027-12-24') } });
  });

  it.each(['source', 'date', 'trust', 'pending'])('rejects an actual %s edit during replacement analysis', async change => {
    gemini.extractStructuredExpiry.mockImplementation(async () => {
      row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
      if (change === 'source') row.googleDriveLink = 'https://drive.google.com/file/d/other-renewal/view';
      if (change === 'date') row.expiryDate = date('2027-01-01');
      if (change === 'trust') row.expiryConfidence = 0.4;
      if (change === 'pending') row.expiryStatus = 'AWAITING_REMINDER';
      return { expiryDate: date('2027-12-31'), confidence: 0.95, method: 'GEMINI' };
    });
    await expect(replacement()).rejects.toMatchObject({ status: 409 });
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(drive.deleteFile.mock.calls).toEqual([['new-source']]);
  });

  it('catches a source change between its transactional reread and guarded update', async () => {
    prisma.document.update.mockRejectedValueOnce(Object.assign(new Error('Changed after reread'), { code: 'P2025' }));
    await expect(replacement()).rejects.toMatchObject({ status: 409 });
    expect(row.googleDriveLink).toContain('old-source');
    expect(drive.deleteFile.mock.calls).toEqual([['new-source']]);
  });

  it('rolls back the source, date and old notifications if saving the new schedule fails', async () => {
    const original = structuredClone({ row, reminders, notifications });
    prisma.documentReminder.upsert.mockRejectedValue(new Error('Database unavailable'));
    await expect(replacement()).rejects.toThrow('original document and reminder were preserved');
    expect({ row, reminders, notifications }).toEqual(original);
    expect(drive.deleteFile.mock.calls).toEqual([['new-source']]);
    expect(gemini.deleteGeminiFile.mock.calls).toEqual([['files/new-index']]);
  });

  it.each(['original edit', 'replacement edit', 'source moved'])('does not commit after a live %s during Gemini analysis', async change => {
    gemini.extractStructuredExpiry.mockImplementation(async () => {
      if (change === 'original edit') oldMetadata.md5Checksum = 'changed';
      if (change === 'replacement edit') newMetadata.md5Checksum = 'wrong-content';
      if (change === 'source moved') drive.getCompanyFileMetadata.mockRejectedValue(new Error('Source is outside company'));
      return { expiryDate: date('2027-12-31'), confidence: 0.95, method: 'GEMINI' };
    });
    await expect(replacement()).rejects.toThrow(/preserved/);
    expect(row.googleDriveLink).toContain('old-source');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(drive.deleteFile.mock.calls).toEqual([['new-source']]);
  });

  it('returns a committed replacement with a warning when old source cleanup fails', async () => {
    drive.deleteFile.mockRejectedValue(new Error('Cannot remove old file'));
    const result = await replacement();
    expect(result).toMatchObject({ id: 42, driveFileId: 'new-source', cleanupWarning: expect.stringContaining('previous Drive copy was retained') });
    expect(row.googleDriveLink).toBe(newLink);
    expect(drive.deleteFile.mock.calls).toEqual([['old-source']]);
    expect(gemini.deleteGeminiFile.mock.calls).toEqual([['files/old-index']]);
  });

  it('retains an old source edited externally after commit and warns instead of deleting it', async () => {
    let oldReads = 0;
    drive.getCompanyFileMetadata.mockImplementation(async id => {
      if (id !== 'old-source') return structuredClone(newMetadata);
      oldReads += 1;
      return { ...oldMetadata, ...(oldReads === 3 ? { version: '2' } : {}) };
    });
    const result = await replacement();
    expect(result).toMatchObject({ id: 42, driveFileId: 'new-source', cleanupWarning: expect.stringContaining('retained') });
    expect(drive.deleteFile).not.toHaveBeenCalled();
    expect(row.googleDriveLink).toBe(newLink);
  });

  it('does not upload or overwrite old data when initial source authorization fails', async () => {
    drive.getCompanyFileMetadata.mockRejectedValue(new Error('Drive source not authorized'));
    await expect(replacement()).rejects.toThrow('Drive source not authorized');
    expect(drive.uploadFileToDrive).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not let a late Mark Handled for the old expiry fulfill the reused reminder ID', async () => {
    await replacement();
    prisma.document.findMany.mockResolvedValue([{ id: row.id, googleDriveLink: row.googleDriveLink }]);
    await expect(service.updateNotificationStatus(9, 'FULFILLED', 'Olten',
      { expectedExpiryDate: '2026-10-12', expectedDriveFileId: 'new-source' })).rejects.toMatchObject({ status: 409 });
    expect(reminders[0].status).toBe('PENDING');
  });

  it('rejects a stale source even when a replacement has the same expiry and reminder ID', async () => {
    gemini.extractStructuredExpiry.mockResolvedValue({ expiryDate: date('2026-10-12'), confidence: 0.95, method: 'GEMINI' });
    await replacement();
    prisma.document.findMany.mockResolvedValue([{ id: row.id, googleDriveLink: row.googleDriveLink }]);
    await expect(service.updateNotificationStatus(9, 'FULFILLED', 'Olten',
      { expectedExpiryDate: '2026-10-12', expectedDriveFileId: 'old-source' })).rejects.toMatchObject({ status: 409 });
    expect(prisma.documentReminder.updateMany).not.toHaveBeenCalled();
    expect(reminders[0].status).toBe('PENDING');
  });

  it('atomically guards the source if replacement commits between status source lookup and update', async () => {
    prisma.document.findMany.mockImplementation(async () => {
      const previous = { id: row.id, googleDriveLink: row.googleDriveLink };
      row.googleDriveLink = newLink;
      return [previous];
    });
    reminders[0].status = 'PENDING';
    await expect(service.updateNotificationStatus(9, 'FULFILLED', 'Olten',
      { expectedExpiryDate: '2026-10-12', expectedDriveFileId: 'old-source' })).rejects.toMatchObject({ status: 409 });
    expect(prisma.documentReminder.updateMany.mock.calls[0][0].where.document).toMatchObject({ company: 'Olten', status: 'ACTIVE',
      OR: [{ id: 42, googleDriveLink: 'https://drive.google.com/file/d/old-source/view' }] });
    expect(reminders[0].status).toBe('PENDING');
  });

  it('handles the current cycle using exact source ID even with duplicate names and partial source matches', async () => {
    await replacement();
    prisma.document.findMany.mockResolvedValue([{ id: 100, googleDriveLink: 'https://drive.google.com/file/d/new-source-copy/view' },
      { id: row.id, googleDriveLink: row.googleDriveLink }]);
    expect(await service.updateNotificationStatus(9, 'FULFILLED', 'Olten',
      { expectedExpiryDate: '2027-12-31T00:00:00.000Z', expectedDriveFileId: 'new-source' })).toEqual({ success: true });
    expect(reminders[0].status).toBe('FULFILLED');
    expect(prisma.documentReminder.updateMany.mock.calls[0][0].where.document.OR).toHaveLength(1);
  });

  it('keeps legacy status callers working and validates malformed expected cycle fields', async () => {
    expect(await service.updateNotificationStatus(9, 'FULFILLED', 'Olten')).toEqual({ success: true });
    expect(prisma.documentReminder.updateMany.mock.calls[0][0].where).toEqual({ id: 9, company: 'Olten' });
    await expect(service.updateNotificationStatus(9, 'FULFILLED', 'Olten', { expectedExpiryDate: 'tomorrow' })).rejects.toMatchObject({ status: 400 });
    await expect(service.updateNotificationStatus(9, 'FULFILLED', 'Olten', { expectedDriveFileId: '../private' })).rejects.toMatchObject({ status: 400 });
  });
});
   
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn() }));
jest.mock('./gemini.service', () => ({ GeminiService: jest.fn() }));
jest.mock('./drive.service', () => ({ DriveService: jest.fn() }));

import { PrismaClient } from '@prisma/client';
import { DocumentService } from './document.service';
import { ExpiryExtractorService } from './expiry-extractor.service';
import { Readable } from 'stream';

const prisma = (PrismaClient as unknown as jest.Mock).mock.instances[0];
const date = (day: string) => new Date(`${day}T00:00:00.000Z`);

describe('document expiry and user reminders', () => {
  let service: DocumentService;
  let gemini: any;
  let drive: any;
  const doc = () => ({ id: 1, company: 'Olten', filename: 'permit.pdf', originalName: 'permit.pdf',
    mimeType: 'application/pdf', status: 'ACTIVE', expiryDate: date('2026-10-06'),
    expiryConfidence: 0.95, expiryStatus: 'EXPIRING_SOON', expiryDetectionMethod: 'GEMINI',
    googleDriveLink: 'https://drive.google.com/file/d/drive-permit/view', geminiFileUri: 'expired-uri' });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-05T04:00:00.000Z'));
    process.env.DOCUMENT_EXPIRY_TIMEZONE = 'Asia/Manila';
    prisma.document = {
      create: jest.fn(async ({ data }) => ({ id: 1, ...data })),
      findFirst: jest.fn(async () => doc()), findMany: jest.fn(async () => []),
      update: jest.fn(async ({ data }) => ({ ...doc(), ...data })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    };
    prisma.documentReminder = {
      findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })), updateMany: jest.fn(async () => ({ count: 1 })),
      upsert: jest.fn(async ({ create }) => ({ id: 10, ...create })),
    };
    prisma.expiryNotification = { deleteMany: jest.fn(async () => ({ count: 0 })) };
    prisma.$transaction = jest.fn(async callback => callback(prisma));
    gemini = {
      normalizeMimeType: jest.fn(() => 'application/pdf'),
      uploadFileToGemini: jest.fn(async () => ({ fileId: 'files/permit', fileUri: 'gemini-uri' })),
      deleteGeminiFile: jest.fn(async () => undefined),
      extractStructuredExpiry: jest.fn(async () => ({ documentType: 'Permit', documentNumber: null,
        issueDate: null, expiryDate: date('2026-10-06'), renewalDate: null, renewalDaysBeforeExpiry: null,
        expiryDateText: 'Valid until October 6, 2026', confidence: 0.95, method: 'GEMINI' })),
    };
    drive = { uploadFileToDrive: jest.fn(async () => doc().googleDriveLink),
      downloadFile: jest.fn(async () => Buffer.from('original PDF bytes')),
      getCompanyDirectory: jest.fn(async () => ({ companyFolderId: 'company-root', folders: [],
        files: [{ id: 'drive-permit', name: 'permit.pdf' }] })),
      deleteFile: jest.fn(async () => undefined),
      downloadFileStream: jest.fn(async () => ({ stream: Readable.from(Buffer.from('PDF')), mimeType: 'application/pdf', name: 'permit.pdf' })),
      downloadCompanyFileStream: jest.fn(async () => ({ stream: Readable.from(Buffer.from('PDF')), mimeType: 'application/pdf', name: 'permit.pdf' })),
      createSubFolder: jest.fn(async () => ({ id: 'created-folder' })),
      renameFolder: jest.fn(async () => ({ id: 'renamed-folder' })) };
    service = new DocumentService(gemini, drive, new ExpiryExtractorService());
  });

  afterEach(() => { jest.useRealTimers(); delete process.env.DOCUMENT_EXPIRY_TIMEZONE; });

  it('automatically saves an immediately due reminder for tomorrow with a 2 day lead', async () => {
    const result = await service.processNewDocument({ originalname: 'permit.pdf', mimetype: 'application/pdf',
      buffer: Buffer.from('PDF') }, 'Olten', 'admin', undefined, { reminderDays: '2' });
    expect(gemini.extractStructuredExpiry).toHaveBeenCalledTimes(1);
    expect(result.expiryDate).toEqual(date('2026-10-06'));
    expect(result.reminder).toMatchObject({ reminderDays: 2, triggerDate: date('2026-10-04'), isTriggered: true });
  });

  it('shares the indexing upload with expiry analysis while preserving search metadata', async () => {
    const indexed = Promise.resolve({ fileId: 'files/shared', fileUri: 'uri/shared', mimeType: 'application/pdf' });
    gemini.uploadFileToGemini.mockReturnValueOnce(indexed);
    gemini.extractStructuredExpiry.mockImplementationOnce(async (_buffer, _mime, _name, readyFile) => {
      expect(readyFile).toBe(indexed);
      expect(await readyFile).toMatchObject({ fileUri: 'uri/shared' });
      return { expiryDate: date('2026-10-06'), confidence: 0.95, method: 'GEMINI' };
    });
    const result = await service.processNewDocument({ originalname: 'large.pdf', mimetype: 'application/pdf',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }, 'Olten', 'admin', undefined, { reminderSetup: 'after-upload' });
    expect(gemini.uploadFileToGemini).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ geminiFileUri: 'uri/shared', geminiFileId: 'files/shared',
      expiryDate: date('2026-10-06'), reminderSetupPending: true });
    expect(gemini.deleteGeminiFile).not.toHaveBeenCalled();
  });

  it('waits for the post-upload review without creating a default reminder', async () => {
    const result = await service.processNewDocument({ originalname: 'permit.pdf', mimetype: 'application/pdf',
      buffer: Buffer.from('PDF') }, 'Olten', 'admin', undefined, { reminderSetup: 'after-upload' });
    expect(result).toMatchObject({ reminder: null, reminderSetupPending: true, expiryStatus: 'EXPIRING_SOON', daysRemaining: 1 });
    expect(prisma.document.create.mock.calls[0][0].data.expiryStatus).toBe('AWAITING_REMINDER');
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('keeps missing-date uploads pending so later reanalysis does not activate a default', async () => {
    gemini.extractStructuredExpiry.mockResolvedValue(null);
    const result = await service.processNewDocument({ originalname: 'permit.pdf', mimetype: 'application/pdf',
      buffer: Buffer.from('PDF') }, 'Olten', 'admin', undefined, { reminderSetup: 'after-upload' });
    expect(result).toMatchObject({ expiryStatus: 'NO_EXPIRY', reminderSetupPending: true, reminder: null });
    expect(prisma.document.create.mock.calls[0][0].data.expiryStatus).toBe('AWAITING_REMINDER');
  });

  it('keeps an after-upload date pending when reanalysis finds a valid expiry', async () => {
    prisma.document.findFirst.mockResolvedValue({ ...doc(), expiryDate: null, expiryStatus: 'AWAITING_REMINDER' });
    const result = await service.reanalyzeDocument(1, 'Olten');
    expect(result).toMatchObject({ expiryDate: date('2026-10-06'), reminderSetupPending: true, reminder: null });
    expect(prisma.document.update.mock.calls[0][0].data.expiryStatus).toBe('AWAITING_REMINDER');
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('activates a post-upload reminder only when the user saves their choice', async () => {
    prisma.document.findFirst.mockResolvedValue({ ...doc(), expiryStatus: 'AWAITING_REMINDER' });
    const result = await service.saveReminders([{ id: 1, expiryDate: '2026-10-06', reminderDays: 3 }], 'Olten');
    expect(prisma.document.update.mock.calls[0][0].data.expiryStatus).toBe('EXPIRING_SOON');
    expect(result.reminders[0]).toMatchObject({ reminderDays: 3, isTriggered: true });
  });

  it('clears only the owned document schedules and returns explicit null reminder values', async () => {
    const result = await service.clearReminder(1, 'Olten');
    expect(prisma.document.findFirst).toHaveBeenCalledWith({ where: { id: 1, company: 'Olten' } });
    expect(prisma.document.update.mock.calls[0][0]).toMatchObject({
      where: { id: 1, company: 'Olten', expiryStatus: 'EXPIRING_SOON', expiryDate: date('2026-10-06') },
      data: { expiryStatus: 'REMINDER_DISABLED' },
    });
    expect(prisma.documentReminder.deleteMany).toHaveBeenCalledWith({ where: { documentId: 1, company: 'Olten' } });
    expect(prisma.expiryNotification.deleteMany).toHaveBeenCalledWith({ where: { documentId: 1, company: 'Olten' } });
    expect(result).toMatchObject({ reminder: null, reminderValue: null, reminderUnit: null, reminderDays: null,
      reminderDisabled: true, reminderSetupPending: false, expiryDate: date('2026-10-06'), daysRemaining: 1 });
    expect(result.reminderWarning).toContain('disabled');
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
    expect(drive.deleteFile).not.toHaveBeenCalled();
    expect(gemini.extractStructuredExpiry).not.toHaveBeenCalled();
  });

  it('retains uncertain expiry review when disabling a reminder', async () => {
    prisma.document.findFirst.mockResolvedValue({ ...doc(), expiryStatus: 'AWAITING_REMINDER_REVIEW', expiryConfidence: 0.5 });
    const result = await service.clearReminder(1, 'Olten');
    expect(prisma.document.update.mock.calls[0][0].data.expiryStatus).toBe('REMINDER_DISABLED_REVIEW');
    expect(result).toMatchObject({ expiryStatus: 'NEEDS_REVIEW', reminderDisabled: true, reminder: null });
    expect(result.reminderWarning).not.toContain('Choose');
  });

  it('rejects another company and changed snapshots before clearing any reminders', async () => {
    prisma.document.findFirst.mockResolvedValue(null);
    await expect(service.clearReminder(1, 'Other')).rejects.toThrow('not found in this company');
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(prisma.documentReminder.deleteMany).not.toHaveBeenCalled();
    prisma.document.findFirst.mockResolvedValue(doc());
    prisma.document.update.mockRejectedValue(Object.assign(new Error('Changed'), { code: 'P2025' }));
    await expect(service.clearReminder(1, 'Olten')).rejects.toThrow('changed while clearing');
    expect(prisma.documentReminder.deleteMany).not.toHaveBeenCalled();
    expect(prisma.expiryNotification.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['REMINDER_DISABLED', 'REMINDER_DISABLED_REVIEW'])
    ('updates expiry evidence without recreating a disabled reminder from %s', async expiryStatus => {
      prisma.document.findFirst.mockResolvedValue({ ...doc(), expiryStatus });
      const result = await service.reanalyzeDocument(1, 'Olten');
      expect(result).toMatchObject({ expiryDate: date('2026-10-06'), reminderDisabled: true,
        reminderSetupPending: false, reminder: null, reminderValue: null, reminderUnit: null, reminderDays: null });
      expect(prisma.document.update.mock.calls[0][0].data).toMatchObject({
        expiryStatus: 'REMINDER_DISABLED', expiryDateText: 'Valid until October 6, 2026' });
      expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
    });

  it('reactivates a disabled reminder only on explicit save even if an old fulfilled row remains', async () => {
    prisma.document.findFirst.mockResolvedValue({ ...doc(), expiryStatus: 'REMINDER_DISABLED' });
    prisma.documentReminder.findUnique.mockResolvedValue({ expiryDate: date('2026-10-06'),
      triggerDate: date('2026-10-04'), status: 'FULFILLED' });
    await service.saveReminders([{ id: 1, reminderDays: 2 }], 'Olten');
    expect(prisma.document.update.mock.calls[0][0].data.expiryStatus).toBe('EXPIRING_SOON');
    expect(prisma.documentReminder.upsert.mock.calls[0][0].update.status).toBe('PENDING');
  });

  it('lets an explicit clear win over same-date reanalysis already running', async () => {
    let current = doc();
    prisma.document.findFirst.mockImplementation(async () => ({ ...current }));
    prisma.document.update.mockImplementation(async ({ where, data }) => {
      if (where.expiryStatus !== current.expiryStatus) throw Object.assign(new Error('Reminder disabled'), { code: 'P2025' });
      current = { ...current, ...data };
      return { ...current };
    });
    gemini.extractStructuredExpiry.mockImplementation(async () => {
      await service.clearReminder(1, 'Olten');
      return { expiryDate: date('2026-10-06'), confidence: 0.95, method: 'GEMINI' };
    });
    await expect(service.reanalyzeDocument(1, 'Olten')).rejects.toThrow('current expiry and reminder were preserved');
    expect(current.expiryStatus).toBe('REMINDER_DISABLED');
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
    expect(prisma.documentReminder.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does not let old reanalysis overwrite a same-date replacement source', async () => {
    let current = doc();
    prisma.document.findFirst.mockImplementation(async () => ({ ...current }));
    prisma.document.update.mockImplementation(async ({ where, data }) => {
      if (where.googleDriveLink !== current.googleDriveLink) throw Object.assign(new Error('Source replaced'), { code: 'P2025' });
      current = { ...current, ...data };
      return { ...current };
    });
    gemini.extractStructuredExpiry.mockImplementation(async () => {
      current = { ...current, googleDriveLink: 'https://drive.google.com/file/d/renewed-source/view' };
      return { expiryDate: date('2026-10-06'), confidence: 0.95, method: 'GEMINI' };
    });
    await expect(service.reanalyzeDocument(1, 'Olten')).rejects.toThrow('current expiry and reminder were preserved');
    expect(current.googleDriveLink).toContain('renewed-source');
    expect(prisma.document.update.mock.calls[0][0].where.googleDriveLink).toContain('drive-permit');
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('returns null values and no notification for disabled documents even with a stale alert row', async () => {
    prisma.document.findMany.mockResolvedValue([{ ...doc(), expiryStatus: 'REMINDER_DISABLED', reminders: [
      { id: 10, reminderType: 'MANUAL', reminderDays: 2, expiryDate: date('2026-10-06'), status: 'PENDING' },
    ] }]);
    drive.getCompanyDirectory.mockResolvedValue({ companyFolderId: 'company-root', folders: [],
      files: [{ id: 'drive-permit', name: 'permit.pdf' }] });
    const directory = await service.getCompanyDirectory('Olten');
    expect(directory.files[0]).toMatchObject({ reminder: null, reminderValue: null, reminderUnit: null, reminderDays: null,
      reminderDisabled: true, reminderSetupPending: false });
    expect(await service.getActiveNotifications('Olten')).toEqual([]);
  });

  it('streams the exact owned active source without invoking Gemini', async () => {
    drive.getCompanyDirectory.mockResolvedValue({ companyFolderId: 'company-root', folders: [],
      files: [{ id: 'drive-permit', name: 'permit.pdf' }] });
    const result = await service.getDocumentContent(1, 'Olten', 'document');
    expect(result.mimeType).toBe('application/pdf');
    expect(drive.downloadCompanyFileStream).toHaveBeenCalledWith('drive-permit', 'Olten', undefined, undefined);
    expect(drive.getCompanyDirectory).not.toHaveBeenCalled();
    expect(gemini.extractStructuredExpiry).not.toHaveBeenCalled();
  });

  it('requires current company membership for Drive-only and indexed preview sources', async () => {
    drive.downloadCompanyFileStream.mockRejectedValueOnce(new Error('Document not found in this company'))
      .mockRejectedValueOnce(new Error('Document not found in this company'));
    await expect(service.getDocumentContent('drive-permit', 'Olten', 'drive')).rejects.toThrow('not found in this company');
    await expect(service.getDocumentContent(1, 'Olten', 'document')).rejects.toThrow('not found in this company');
    await service.getDocumentContent('unindexed', 'Olten', 'drive');
    expect(drive.downloadCompanyFileStream).toHaveBeenCalledWith('unindexed', 'Olten', undefined, undefined);
    expect(drive.getCompanyDirectory).not.toHaveBeenCalled();
  });

  it('rejects invalid preview IDs and disallowed source modes without downloading', async () => {
    await expect(service.getDocumentContent('../private', 'Olten', 'drive')).rejects.toThrow('Invalid document ID');
    await expect(service.getDocumentContent(1, 'Olten', 'external')).rejects.toThrow('Invalid document source');
    prisma.document.findFirst.mockResolvedValue({ ...doc(), status: 'DELETED' });
    await expect(service.getDocumentContent(1, 'Olten', 'document')).rejects.toThrow('not found in this company');
    expect(drive.downloadCompanyFileStream).not.toHaveBeenCalled();
  });

  it('forwards range validators after document identity checks without rescanning the company', async () => {
    await service.getDocumentContent(1, 'Olten', 'document', 'bytes=0-1023', '"current-version"');
    expect(drive.downloadCompanyFileStream).toHaveBeenCalledWith('drive-permit', 'Olten', 'bytes=0-1023', '"current-version"');
    expect(drive.getCompanyDirectory).not.toHaveBeenCalled();
  });

  it('rejects inactive indexed files even when a Drive ID is used instead of its database ID', async () => {
    prisma.document.findMany.mockResolvedValue([{ ...doc(), status: 'DELETED' }]);
    await expect(service.getDocumentContent('drive-permit', 'Olten', 'drive')).rejects.toThrow('not found in this company');
    expect(drive.downloadCompanyFileStream).not.toHaveBeenCalled();
  });

  it('checks exact IDs when considering inactive indexed rows with a similar Drive ID', async () => {
    prisma.document.findMany.mockResolvedValue([{ ...doc(), googleDriveLink: 'https://drive.google.com/file/d/drive-permit-copy/view', status: 'DELETED' }]);
    await service.getDocumentContent('drive-permit', 'Olten', 'drive');
    expect(drive.downloadCompanyFileStream).toHaveBeenCalledWith('drive-permit', 'Olten', undefined, undefined);
  });

  it('restricts folder creation parents and rename targets to the current company', async () => {
    drive.getCompanyDirectory.mockResolvedValue({ companyFolderId: 'company-root',
      folders: [{ id: 'own-folder' }], files: [] });
    await expect(service.createFolder('Olten', 'Folder', 'other-folder')).rejects.toThrow('not found in this company');
    await expect(service.renameFolder('other-folder', 'Olten', 'Renamed')).rejects.toThrow('not found in this company');
    expect(drive.createSubFolder).not.toHaveBeenCalled();
    expect(drive.renameFolder).not.toHaveBeenCalled();
    await service.createFolder('Olten', 'Folder', 'own-folder');
    await service.renameFolder('own-folder', 'Olten', 'Renamed');
    expect(drive.createSubFolder).toHaveBeenCalledWith('Olten', 'Folder', 'own-folder');
    expect(drive.renameFolder).toHaveBeenCalledWith('own-folder', 'Renamed');
  });

  it('rejects uploads to another company folder before spending Gemini tokens or writing a file', async () => {
    await expect(service.processNewDocument({ originalname: 'permit.pdf', mimetype: 'application/pdf',
      buffer: Buffer.from('PDF') }, 'Olten', 'admin', 'other-folder', { reminderSetup: 'after-upload' }))
      .rejects.toThrow('not found in this company');
    expect(gemini.uploadFileToGemini).not.toHaveBeenCalled();
    expect(gemini.extractStructuredExpiry).not.toHaveBeenCalled();
    expect(drive.uploadFileToDrive).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it.each(['../permit.pdf', 'bad\r\nname.pdf', 'a'.repeat(256), ''])
    ('rejects unsafe upload filenames before contacting Google: %j', async originalname => {
      await expect(service.processNewDocument({ originalname, mimetype: 'application/pdf',
        buffer: Buffer.from('PDF') }, 'Olten', 'admin')).rejects.toThrow('Invalid filename');
      expect(gemini.uploadFileToGemini).not.toHaveBeenCalled();
      expect(drive.uploadFileToDrive).not.toHaveBeenCalled();
    });

  it('saves the selected calendar months and triggers immediately inside that window', async () => {
    const result = await service.processNewDocument({ originalname: 'permit.pdf', mimetype: 'application/pdf',
      buffer: Buffer.from('PDF') }, 'Olten', 'admin', undefined, { reminderValue: '2', reminderUnit: 'months' });
    expect(result.reminder).toMatchObject({ reminderType: 'MANUAL_MONTHS_2',
      reminderUnit: 'months', reminderValue: 2, triggerDate: date('2026-08-06'), isTriggered: true });
  });

  it('keeps no-expiry files without making a fake reminder', async () => {
    gemini.extractStructuredExpiry.mockResolvedValue(null);
    const result = await service.processNewDocument({ originalname: 'permit.pdf', mimetype: 'application/pdf',
      buffer: Buffer.from('PDF') }, 'Olten', 'admin');
    expect(result).toMatchObject({ expiryStatus: 'NO_EXPIRY', reminder: null });
    expect(result.reminderWarning).toContain('Re-analyze');
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('reports Gemini errors distinctly and does not schedule an unverified expiry', async () => {
    gemini.extractStructuredExpiry.mockRejectedValue(new Error('Quota exceeded'));
    const result = await service.processNewDocument({ originalname: 'permit.pdf', mimetype: 'application/pdf',
      buffer: Buffer.from('PDF') }, 'Olten', 'admin');
    expect(result).toMatchObject({ expiryStatus: 'NEEDS_REVIEW', reminder: null });
    expect(result.detectionWarning).toContain('Quota exceeded');
  });

  it('holds a low-confidence date for review without a notification', async () => {
    gemini.extractStructuredExpiry.mockResolvedValue({ expiryDate: date('2026-10-06'), confidence: 0.6, method: 'GEMINI' });
    const result = await service.processNewDocument({ originalname: 'permit.pdf', mimetype: 'application/pdf',
      buffer: Buffer.from('PDF') }, 'Olten', 'admin');
    expect(result).toMatchObject({ expiryStatus: 'NEEDS_REVIEW', reminder: null });
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('honors a zero day lead and leaves tomorrow scheduled for tomorrow', async () => {
    const result = await service.saveReminders([{ id: 1, expiryDate: '2026-10-06', reminderDays: 0 }], 'Olten');
    expect(result.reminders[0]).toMatchObject({ reminderDays: 0, triggerDate: date('2026-10-06'), isTriggered: false });
  });

  it('does not reactivate a fulfilled reminder when the same settings are saved', async () => {
    prisma.documentReminder.findUnique.mockResolvedValue({ expiryDate: date('2026-10-06'),
      triggerDate: date('2026-10-04'), status: 'FULFILLED' });
    await service.saveReminders([{ id: 1, expiryDate: '2026-10-06', reminderDays: 2 }], 'Olten');
    expect(prisma.documentReminder.upsert.mock.calls[0][0].update).not.toHaveProperty('status');
  });

  it('rejects reminder setup for an untrusted date without upgrading AI confidence', async () => {
    prisma.document.findFirst.mockResolvedValue({ ...doc(), expiryStatus: 'NEEDS_REVIEW', expiryConfidence: 0.5 });
    prisma.documentReminder.findUnique.mockResolvedValue({ expiryDate: date('2026-10-06'),
      triggerDate: date('2026-10-04'), status: 'FULFILLED' });
    await expect(service.saveReminders([{ id: 1, reminderDays: 2 }], 'Olten')).rejects.toThrow('reliable expiry');
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('rejects a legacy low-confidence date even when its stored status is stale', async () => {
    prisma.document.findFirst.mockResolvedValue({ ...doc(), expiryStatus: 'ACTIVE', expiryConfidence: 0.5 });
    prisma.documentReminder.findUnique.mockResolvedValue({ expiryDate: date('2026-10-06'),
      triggerDate: date('2026-10-04'), status: 'FULFILLED' });
    await expect(service.saveReminders([{ id: 1, expiryDate: '2026-10-06', reminderDays: 2 }], 'Olten')).rejects.toThrow('reliable expiry');
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('removes remote copies if saving the document/reminder transaction fails', async () => {
    prisma.document.create.mockRejectedValue(new Error('Database unavailable'));
    drive.deleteFile = jest.fn(async () => undefined);
    await expect(service.processNewDocument({ originalname: 'permit.pdf', mimetype: 'application/pdf',
      buffer: Buffer.from('PDF') }, 'Olten', 'admin')).rejects.toThrow('could not be saved');
    expect(drive.deleteFile).toHaveBeenCalledWith('drive-permit');
    expect(gemini.deleteGeminiFile).toHaveBeenCalledWith('files/permit');
  });

  it('rejects impossible dates and negative lead times before writes', async () => {
    await expect(service.saveReminders([{ id: 1, expiryDate: '2026-02-30', reminderDays: 2 }], 'Olten')).rejects.toThrow();
    await expect(service.saveReminders([{ id: 1, expiryDate: '2026-10-06', reminderDays: -1 }], 'Olten')).rejects.toThrow();
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('refuses another company document and reminder status changes', async () => {
    prisma.document.findFirst.mockResolvedValue(null);
    await expect(service.updateManualExpiry(1, 'Other', '2026-10-06')).rejects.toThrow('Document not found');
    expect(prisma.document.update).not.toHaveBeenCalled();
    prisma.documentReminder.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateNotificationStatus(10, 'FULFILLED', 'Other')).rejects.toThrow('Reminder not found');
    expect(prisma.documentReminder.updateMany).toHaveBeenCalledWith({ where: { id: 10, company: 'Other' }, data: { status: 'FULFILLED' } });
  });

  it('allows the legacy endpoint to edit reminder settings while preserving the detected date', async () => {
    prisma.documentReminder.findMany.mockResolvedValue([{ reminderType: 'MANUAL_MONTHS_2', reminderDays: 61 }]);
    prisma.document.findMany.mockResolvedValue([doc()]);
    const result = await service.updateManualExpiry('drive-permit', 'Olten', '2026-10-06');
    expect(result.reminder).toMatchObject({ reminderType: 'MANUAL_MONTHS_2', triggerDate: date('2026-08-06') });
    expect(result.expiryDetectionMethod).toBe('GEMINI');
    expect(prisma.document.update.mock.calls[0][0].data).not.toHaveProperty('expiryDate');
  });

  it('uses the stored expiry when omitted and preserves AI evidence and confidence', async () => {
    const detected = { ...doc(), expiryStatus: 'AWAITING_REMINDER', expiryDateText: 'Valid until October 6, 2026' };
    prisma.document.findFirst.mockResolvedValue(detected);
    prisma.document.update.mockImplementation(async ({ data }) => ({ ...detected, ...data }));
    const result = await service.saveReminders([{ id: 1, reminderValue: 2, reminderUnit: 'months' }], 'Olten');
    expect(result.reminders[0]).toMatchObject({ expiryDate: detected.expiryDate, reminderUnit: 'months', reminderValue: 2 });
    expect(prisma.document.update.mock.calls[0][0].data).toEqual({ expiryStatus: 'EXPIRING_SOON', lastExpiryCheck: expect.any(Date) });
    expect(prisma.document.update.mock.calls[0][0].where).toMatchObject({ expiryDate: detected.expiryDate,
      expiryStatus: 'AWAITING_REMINDER', expiryDetectionMethod: 'GEMINI', expiryConfidence: 0.95 });
  });

  it('rejects human expiry changes through both scheduling endpoints', async () => {
    await expect(service.saveReminders([{ id: 1, expiryDate: '2027-01-01', reminderDays: 2 }], 'Olten')).rejects.toThrow('cannot be edited');
    await expect(service.updateManualExpiry(1, 'Olten', '2027-01-01', { reminderDays: 2 })).rejects.toThrow('cannot be edited');
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it.each([
    { expiryDate: null, expiryStatus: 'AWAITING_REMINDER' },
    { expiryStatus: 'AWAITING_REMINDER_REVIEW' },
  ])('keeps reminders inactive when no reliable source expiry exists: %j', async overrides => {
    prisma.document.findFirst.mockResolvedValue({ ...doc(), ...overrides });
    await expect(service.saveReminders([{ id: 1, reminderDays: 2 }], 'Olten')).rejects.toThrow('reliable expiry');
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('reads the current detected date inside the scheduling transaction', async () => {
    prisma.$transaction.mockImplementation(async callback => {
      prisma.document.findFirst.mockResolvedValue({ ...doc(), expiryDate: date('2026-11-06') });
      return callback(prisma);
    });
    await expect(service.saveReminders([{ id: 1, expiryDate: '2026-10-06', reminderDays: 2 }], 'Olten')).rejects.toThrow('current detected date');
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('preserves analysis that changes the date after scheduling validation', async () => {
    prisma.document.update.mockRejectedValue(Object.assign(new Error('Detected expiry changed'), { code: 'P2025' }));
    await expect(service.saveReminders([{ id: 1, reminderDays: 2 }], 'Olten')).rejects.toThrow('detected expiry changed while saving');
    expect(prisma.document.update.mock.calls[0][0].where).toMatchObject({ expiryDate: date('2026-10-06'),
      expiryDetectionMethod: 'GEMINI', expiryConfidence: 0.95 });
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('reanalyzes the durable Drive copy after a Gemini URI has expired', async () => {
    await service.reanalyzeDocument(1, 'Olten');
    expect(drive.downloadFile).toHaveBeenCalledWith('drive-permit');
    expect(gemini.extractStructuredExpiry).toHaveBeenCalledWith(Buffer.from('original PDF bytes'), 'application/pdf', 'permit.pdf');
  });

  it.each(['moved-to-another-company', 'trashed', 'deleted'])
    ('rejects %s indexed originals before downloading or spending Gemini tokens', async reason => {
      drive.getCompanyDirectory.mockResolvedValue({ companyFolderId: 'company-root', folders: [],
        files: [{ id: 'different-source', name: 'permit.pdf' }] });
      await expect(service.reanalyzeDocument(1, 'Olten')).rejects.toThrow('no longer available in this company');
      expect(drive.downloadFile).not.toHaveBeenCalled();
      expect(gemini.extractStructuredExpiry).not.toHaveBeenCalled();
      expect(prisma.document.update).not.toHaveBeenCalled();
    });

  it.each([{ status: 'DELETED' }, { googleDriveLink: null }, { googleDriveLink: 'invalid-link' }])
    ('rejects inactive or unavailable originals without using retained Gemini URIs: %j', async overrides => {
      prisma.document.findFirst.mockResolvedValue({ ...doc(), ...overrides });
      await expect(service.reanalyzeDocument(1, 'Olten')).rejects.toThrow();
      expect(drive.getCompanyDirectory).not.toHaveBeenCalled();
      expect(drive.downloadFile).not.toHaveBeenCalled();
      expect(gemini.extractStructuredExpiry).not.toHaveBeenCalled();
      expect(prisma.document.update).not.toHaveBeenCalled();
    });

  it('preserves the existing expiry and reminder when reanalysis fails', async () => {
    gemini.extractStructuredExpiry.mockRejectedValue(new Error('Unreadable scan'));
    await expect(service.reanalyzeDocument(1, 'Olten')).rejects.toThrow('current expiry and reminder were preserved');
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(prisma.documentReminder.deleteMany).not.toHaveBeenCalled();
  });

  it('guards reanalysis against a manual expiry confirmed during the Gemini request', async () => {
    prisma.document.update.mockRejectedValue(Object.assign(new Error('The expiry was changed by another request'), { code: 'P2025' }));
    await expect(service.reanalyzeDocument(1, 'Olten')).rejects.toThrow('current expiry and reminder were preserved');
    expect(prisma.document.update.mock.calls[0][0].where).toMatchObject({ id: 1, company: 'Olten',
      expiryDate: date('2026-10-06'), expiryDetectionMethod: 'GEMINI', expiryConfidence: 0.95 });
    expect(prisma.documentReminder.findMany).not.toHaveBeenCalled();
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('preserves a same-date reminder confirmed while pending-upload reanalysis is running', async () => {
    let current = { ...doc(), expiryStatus: 'AWAITING_REMINDER' };
    prisma.document.findFirst.mockImplementation(async () => ({ ...current }));
    prisma.document.update.mockImplementation(async ({ where, data }) => {
      if (where.expiryStatus !== undefined && where.expiryStatus !== current.expiryStatus) {
        throw Object.assign(new Error('Reminder setup was confirmed'), { code: 'P2025' });
      }
      current = { ...current, ...data };
      return { ...current };
    });
    gemini.extractStructuredExpiry.mockImplementation(async () => {
      await service.saveReminders([{ id: 1, expiryDate: '2026-10-06', reminderDays: 2 }], 'Olten');
      return { expiryDate: date('2026-10-06'), confidence: 0.95, method: 'GEMINI' };
    });

    await expect(service.reanalyzeDocument(1, 'Olten')).rejects.toThrow('current expiry and reminder were preserved');
    expect(prisma.document.update.mock.calls[1][0].where.expiryStatus).toBe('AWAITING_REMINDER');
    expect(current.expiryStatus).toBe('EXPIRING_SOON');
    expect(prisma.documentReminder.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.documentReminder.upsert.mock.calls[0][0].create).toMatchObject({ reminderDays: 2, status: 'PENDING' });
    expect(prisma.documentReminder.updateMany).not.toHaveBeenCalled();
  });

  it('suppresses automatic rows when a fulfilled user schedule exists', async () => {
    prisma.document.findMany.mockResolvedValue([{ ...doc(), reminders: [
      { id: 11, reminderType: 'MANUAL', reminderDays: 2, status: 'FULFILLED' },
      { id: 12, reminderType: 'AUTO_DEFAULT_30', status: 'PENDING' },
    ] }]);
    expect(await service.getActiveNotifications('Olten')).toEqual([]);
  });

  it('does not expose even a stale automatic reminder while post-upload setup is pending', async () => {
    prisma.document.findMany.mockResolvedValue([{ ...doc(), expiryStatus: 'AWAITING_REMINDER', reminders: [
      { id: 12, reminderType: 'AUTO_DEFAULT_30', status: 'PENDING', expiryDate: date('2026-10-06') },
    ] }]);
    expect(await service.getActiveNotifications('Olten')).toEqual([]);
  });

  it.each(['PENDING', 'PROCESSING'])('keeps a future %s 30-day reminder out of the bell until its selected trigger date', async status => {
    const expiry = date('2026-11-05');
    prisma.document.findMany.mockResolvedValue([{ ...doc(), expiryDate: expiry, reminders: [
      { id: 10, fileName: 'permit.pdf', expiryDate: expiry, triggerDate: date('2026-10-06'),
        reminderDays: 30, reminderType: 'MANUAL', status },
    ] }]);
    expect(await service.getActiveNotifications('Olten')).toEqual([]);
    expect(drive.getCompanyDirectory).not.toHaveBeenCalled();
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
    expect(gemini.extractStructuredExpiry).not.toHaveBeenCalled();
  });

  it('shows the reminder on its trigger day at Manila midnight', async () => {
    jest.setSystemTime(new Date('2026-10-05T16:00:00.000Z'));
    const expiry = date('2026-11-05');
    prisma.document.findMany.mockResolvedValue([{ ...doc(), expiryDate: expiry, reminders: [
      { id: 10, fileName: 'permit.pdf', expiryDate: expiry, triggerDate: date('2026-10-06'),
        reminderDays: 30, reminderType: 'MANUAL', status: 'PENDING' },
    ] }]);
    const notifications = await service.getActiveNotifications('Olten');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ id: 10, documentId: 1, driveFileId: 'drive-permit',
      isTriggered: true, daysRemaining: 30, reminderValue: 30 });
  });

  it('does not restore automatic or expiry-day alerts after Close Without Reminder', async () => {
    jest.setSystemTime(new Date('2026-10-05T16:00:00.000Z'));
    prisma.document.findMany.mockResolvedValue([{ ...doc(), expiryStatus: 'REMINDER_DISABLED', reminders: [
      { id: 10, fileName: 'permit.pdf', expiryDate: doc().expiryDate, triggerDate: date('2026-10-06'),
        reminderDays: 0, reminderType: 'EXPIRED', status: 'PENDING' },
      { id: 11, fileName: 'permit.pdf', expiryDate: doc().expiryDate, triggerDate: date('2026-09-06'),
        reminderDays: 30, reminderType: 'AUTO_DEFAULT_30', status: 'PROCESSING' },
    ] }]);
    expect(await service.getActiveNotifications('Olten')).toEqual([]);
    const directory = await service.getCompanyDirectory('Olten');
    expect(directory.files[0]).toMatchObject({ reminderDisabled: true, reminder: null,
      reminderValue: null, reminderUnit: null, reminderDays: null });
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
    expect(gemini.extractStructuredExpiry).not.toHaveBeenCalled();
  });

  it('shows only the due enabled source when duplicate filenames have different reminder choices', async () => {
    drive.getCompanyDirectory.mockResolvedValue({ companyFolderId: 'company-root', folders: [],
      files: ['drive-permit', 'disabled-copy', 'future-copy'].map(id => ({ id, name: 'permit.pdf' })) });
    const due = { id: 10, fileName: 'permit.pdf', expiryDate: doc().expiryDate,
      triggerDate: date('2026-10-05'), reminderDays: 1, reminderType: 'MANUAL', status: 'PENDING' };
    const futureExpiry = date('2026-11-05');
    prisma.document.findMany.mockResolvedValue([
      { ...doc(), reminders: [due] },
      { ...doc(), id: 2, googleDriveLink: 'https://drive.google.com/file/d/disabled-copy/view',
        expiryStatus: 'REMINDER_DISABLED', reminders: [{ ...due, id: 11 }] },
      { ...doc(), id: 3, googleDriveLink: 'https://drive.google.com/file/d/future-copy/view', expiryDate: futureExpiry,
        reminders: [{ ...due, id: 12, expiryDate: futureExpiry, triggerDate: date('2026-10-06'), reminderDays: 30 }] },
    ]);
    const result = await service.getActiveNotifications('Olten');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ documentId: 1, driveFileId: 'drive-permit', isTriggered: true });
  });

  it('returns exact document and Drive IDs with source links for duplicate filenames', async () => {
    drive.getCompanyDirectory.mockResolvedValue({ companyFolderId: 'company-root', folders: [],
      files: [{ id: 'drive-permit', name: 'permit.pdf' }, { id: 'other-permit', name: 'permit.pdf' }] });
    const reminder = { id: 10, fileName: 'permit.pdf', expiryDate: date('2026-10-06'),
      triggerDate: date('2026-10-03'), reminderDays: 3, reminderType: 'MANUAL', status: 'PENDING' };
    prisma.document.findMany.mockResolvedValue([
      { ...doc(), reminders: [reminder] },
      { ...doc(), id: 2, googleDriveLink: 'https://drive.google.com/file/d/other-permit/view', reminders: [{ ...reminder, id: 11, documentId: 2 }] },
    ]);
    const result = await service.getActiveNotifications('Olten');
    expect(result[0]).toMatchObject({ documentId: 1, driveFileId: 'drive-permit', sourceUrl: doc().googleDriveLink, daysRemaining: 1 });
    expect(result[1]).toMatchObject({ documentId: 2, driveFileId: 'other-permit', sourceUrl: 'https://drive.google.com/file/d/other-permit/view' });
  });

  it('hides externally moved or deleted sources from reminders without deleting saved records', async () => {
    const reminder = { id: 10, fileName: 'permit.pdf', expiryDate: date('2026-10-06'),
      triggerDate: date('2026-10-03'), reminderDays: 3, reminderType: 'MANUAL', status: 'PENDING' };
    prisma.document.findMany.mockResolvedValue([{ ...doc(), reminders: [reminder] },
      { ...doc(), id: 2, googleDriveLink: 'https://drive.google.com/file/d/unavailable-source/view', reminders: [{ ...reminder, id: 11 }] }]);
    const result = await service.getActiveNotifications('Olten');
    expect(result).toHaveLength(1);
    expect(result[0].documentId).toBe(1);
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
    expect(prisma.documentReminder.deleteMany).not.toHaveBeenCalled();
    expect(gemini.extractStructuredExpiry).not.toHaveBeenCalled();
  });

  it('fails closed on unavailable Drive inventory rather than returning stale reminders', async () => {
    prisma.document.findMany.mockResolvedValue([{ ...doc(), reminders: [
      { id: 10, fileName: 'permit.pdf', expiryDate: doc().expiryDate, triggerDate: date('2026-10-05'),
        reminderDays: 1, reminderType: 'MANUAL', status: 'PENDING' },
    ] }]);
    drive.getCompanyDirectory.mockRejectedValue(new Error('Drive unavailable'));
    await expect(service.getActiveNotifications('Olten')).rejects.toThrow('Drive unavailable');
    expect(gemini.extractStructuredExpiry).not.toHaveBeenCalled();
  });

  it('deletes all exact source rows without touching duplicate filenames or partial Drive IDs', async () => {
    const original = { ...doc(), geminiFileId: 'files/permit' };
    const sameSource = { ...original, id: 2, geminiFileId: 'files/permit-copy' };
    const similarId = { ...original, id: 3, googleDriveLink: 'https://drive.google.com/file/d/drive-permit-copy/view' };
    prisma.document.findMany.mockResolvedValue([original, sameSource, similarId]);
    (service as any).companyCache.set('Olten', { cacheName: 'old-cache' });
    await service.deleteDocument('drive-permit', 'Olten');
    expect(drive.deleteFile).toHaveBeenCalledWith('drive-permit');
    expect(prisma.document.deleteMany).toHaveBeenCalledWith({ where: { company: 'Olten', id: { in: [1, 2] } } });
    expect(gemini.deleteGeminiFile.mock.calls).toEqual([['files/permit'], ['files/permit-copy']]);
    expect((service as any).companyCache.has('Olten')).toBe(false);
  });

  it('supports an exact database document ID when deleting its Drive source', async () => {
    prisma.document.findMany.mockResolvedValue([doc()]);
    await service.deleteDocument(1, 'Olten');
    expect(prisma.document.findFirst).toHaveBeenCalledWith({ where: { id: 1, company: 'Olten' } });
    expect(drive.deleteFile).toHaveBeenCalledWith('drive-permit');
    expect(prisma.document.deleteMany).toHaveBeenCalledWith({ where: { company: 'Olten', id: { in: [1] } } });
  });

  it('rejects deletion outside the requested company before any remote or database mutation', async () => {
    prisma.document.findFirst.mockResolvedValue(null);
    await expect(service.deleteDocument(1, 'Other')).rejects.toThrow('not found in this company');
    expect(prisma.document.findMany).toHaveBeenCalledWith({ where: { company: 'Other', googleDriveLink: { contains: '1' } } });
    expect(drive.getCompanyDirectory).toHaveBeenCalledWith('Other');
    expect(drive.deleteFile).not.toHaveBeenCalled();
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
    expect(gemini.deleteGeminiFile).not.toHaveBeenCalled();
  });

  it('allows a Drive-only document only after exact membership in the company directory', async () => {
    drive.getCompanyDirectory.mockResolvedValue({ companyFolderId: 'company-root', folders: [],
      files: [{ id: 'unindexed', name: 'permit.pdf', parents: ['company-root'] }] });
    await service.deleteDocument('unindexed', 'Olten');
    expect(drive.deleteFile).toHaveBeenCalledWith('unindexed');
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
  });

  it('cleans reminders for exact indexed descendants when deleting a company folder', async () => {
    const first = { ...doc(), geminiFileId: 'files/permit' };
    const nested = { ...first, id: 2, googleDriveLink: 'https://drive.google.com/file/d/nested-file/view', geminiFileId: 'files/nested' };
    const outside = { ...first, id: 3, googleDriveLink: 'https://drive.google.com/file/d/outside-file/view' };
    prisma.document.findMany.mockImplementation(async ({ where }) => where.googleDriveLink ? [] : [first, nested, outside]);
    drive.getCompanyDirectory.mockResolvedValue({ companyFolderId: 'company-root', folders: [
      { id: 'folder', mimeType: 'application/vnd.google-apps.folder', parents: ['company-root'] },
      { id: 'nested-folder', mimeType: 'application/vnd.google-apps.folder', parents: ['folder'] },
    ], files: [
      { id: 'drive-permit', parents: ['folder'] }, { id: 'nested-file', parents: ['nested-folder'] },
      { id: 'outside-file', parents: ['company-root'] },
    ] });
    await service.deleteDocument('folder', 'Olten');
    expect(drive.deleteFile).toHaveBeenCalledWith('folder');
    expect(prisma.document.deleteMany).toHaveBeenCalledWith({ where: { company: 'Olten', id: { in: [1, 2] } } });
    expect(gemini.deleteGeminiFile.mock.calls).toEqual([['files/permit'], ['files/nested']]);
  });

  it('keeps indexed documents and reminders when Drive deletion fails', async () => {
    prisma.document.findMany.mockResolvedValue([doc()]);
    drive.deleteFile.mockRejectedValue(new Error('Drive permission denied'));
    (service as any).companyCache.set('Olten', { cacheName: 'old-cache' });
    await expect(service.deleteDocument(1, 'Olten')).rejects.toThrow('Drive permission denied');
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
    expect(gemini.deleteGeminiFile).not.toHaveBeenCalled();
    expect((service as any).companyCache.has('Olten')).toBe(true);
  });

  it.each(['moved-out', 'trashed', 'deleted'])
    ('preserves a %s indexed source and prevents all remote or database deletion', async reason => {
      drive.getCompanyDirectory.mockResolvedValue({ companyFolderId: 'company-root', folders: [], files: [] });
      prisma.document.findMany.mockResolvedValue([doc()]);
      await expect(service.deleteDocument(1, 'Olten')).rejects.toThrow('saved record was preserved');
      expect(drive.deleteFile).not.toHaveBeenCalled();
      expect(prisma.document.deleteMany).not.toHaveBeenCalled();
      expect(gemini.deleteGeminiFile).not.toHaveBeenCalled();
    });

  it('preserves a Gemini-only orphan rather than deleting its retained index remotely', async () => {
    prisma.document.findFirst.mockResolvedValue({ ...doc(), googleDriveLink: null, geminiFileId: 'files/retained' });
    await expect(service.deleteDocument(1, 'Olten')).rejects.toThrow('saved record was preserved');
    expect(drive.deleteFile).not.toHaveBeenCalled();
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
    expect(gemini.deleteGeminiFile).not.toHaveBeenCalled();
  });

  it('requires company context before deleting a document', async () => {
    await expect(service.deleteDocument('drive-permit', '')).rejects.toThrow('Company header missing');
    expect(drive.deleteFile).not.toHaveBeenCalled();
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
  });
});

describe('search only current company Drive sources', () => {
  let service: DocumentService;
  let gemini: any;
  let drive: any;
  let currentFiles: any[];
  let indexedDocs: any[];
  const indexed = (id = 1, driveId = 'drive-one', overrides: any = {}) => ({ id, company: 'Olten',
    status: 'ACTIVE', filename: 'dream.pdf', mimeType: 'application/pdf',
    googleDriveLink: `https://drive.google.com/file/d/${driveId}/view`, geminiFileUri: `gemini-uri-${id}`, ...overrides });
  const source = (id = 'drive-one', name = 'dream.pdf') => ({ id, name, mimeType: 'application/pdf', parents: ['company-root'] });
  const contentQuestion = 'What is the license number in these files?';
  const search = (company = 'Olten', model = 'gemini-test') => service.searchDocuments(contentQuestion, company, 'admin', model);

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-05T04:00:00.000Z'));
    currentFiles = [source()];
    indexedDocs = [indexed()];
    prisma.document = { findMany: jest.fn(async () => indexedDocs), deleteMany: jest.fn(), update: jest.fn() };
    prisma.searchHistory = { create: jest.fn(async () => ({ id: 1 })) };
    gemini = { createDocumentCache: jest.fn(async () => 'cache-current'),
      askQuestion: jest.fn(async () => ({ text: 'Current files only', usage: { promptTokenCount: 12, candidatesTokenCount: 5 } })) };
    drive = { getCompanyDirectory: jest.fn(async () => ({ companyFolderId: 'company-root', folders: [], files: currentFiles })),
      deleteFile: jest.fn() };
    service = new DocumentService(gemini, drive, new ExpiryExtractorService());
  });

  afterEach(() => { jest.useRealTimers(); });

  it('ignores retained ACTIVE index rows and old cache when the actual Drive directory is empty', async () => {
    currentFiles = [];
    (service as any).companyCache.set('Olten', { cacheName: 'old-deleted-files', expiresAt: Date.now() + 60000, model: 'gemini-test' });
    const result = await search();
    expect(result).toMatchObject({ answer: expect.stringContaining('No documents'), sourcesSearched: 0, cached: false });
    expect(drive.getCompanyDirectory).toHaveBeenCalledWith('Olten');
    expect(prisma.document.findMany).not.toHaveBeenCalled();
    expect(gemini.createDocumentCache).not.toHaveBeenCalled();
    expect(gemini.askQuestion).not.toHaveBeenCalled();
    expect(prisma.searchHistory.create).not.toHaveBeenCalled();
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
    expect(drive.deleteFile).not.toHaveBeenCalled();
    expect((service as any).companyCache.has('Olten')).toBe(false);
  });

  it('matches exact Drive IDs despite duplicate names and partial IDs when one source was deleted', async () => {
    indexedDocs = [indexed(), indexed(2, 'drive-one-copy')];
    currentFiles = [source('drive-one-copy')];
    const result = await search();
    expect(result).toMatchObject({ sourcesSearched: 1, cached: true });
    expect(gemini.askQuestion).toHaveBeenCalledWith(contentQuestion, [{ uri: 'gemini-uri-2', mimeType: 'application/pdf',
      name: 'dream.pdf', driveLink: 'https://drive.google.com/file/d/drive-one-copy/view' }], 'cache-current', 'gemini-test');
    expect(prisma.document.findMany.mock.calls[0][0].where).toEqual({ company: 'Olten', status: 'ACTIVE' });
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
    expect(drive.deleteFile).not.toHaveBeenCalled();
  });

  it('lists one physical source once when multiple retained index rows point to it', async () => {
    indexedDocs = [indexed(), indexed(2, 'drive-one')];
    expect(await search()).toMatchObject({ sourcesSearched: 1 });
    expect(gemini.askQuestion.mock.calls[0][1][0].uri).toBe('gemini-uri-2');
  });

  it('preserves the indexing message for current Drive files that have no available index', async () => {
    indexedDocs = [indexed(1, 'removed-source')];
    (service as any).companyCache.set('Olten', { cacheName: 'stale', expiresAt: Date.now() + 60000, model: 'gemini-test' });
    await expect(search()).rejects.toThrow('have not finished indexing');
    expect(gemini.createDocumentCache).not.toHaveBeenCalled();
    expect(gemini.askQuestion).not.toHaveBeenCalled();
    expect(prisma.searchHistory.create).not.toHaveBeenCalled();
    expect((service as any).companyCache.has('Olten')).toBe(false);
  });

  it('reuses a cache only when the exact source fingerprint and model remain unchanged', async () => {
    indexedDocs = [indexed(), indexed(2, 'drive-two')];
    currentFiles = [source(), source('drive-two')];
    await search();
    currentFiles.reverse();
    indexedDocs.reverse();
    await service.searchDocuments('What is the document title?', 'Olten', 'admin', 'gemini-test');
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(1);
    expect(gemini.askQuestion.mock.calls.map(call => call[2])).toEqual(['cache-current', 'cache-current']);
    expect(prisma.searchHistory.create).toHaveBeenCalledTimes(2);
    expect(prisma.searchHistory.create.mock.calls[0][0].data).toMatchObject({ username: 'admin', company: 'Olten',
      query: contentQuestion, response: 'Current files only', modelUsed: 'gemini-test', promptTokens: 12, completionTokens: 5 });
    expect(drive.getCompanyDirectory).toHaveBeenCalledTimes(4);
  });

  it.each(['Which files do I have?', 'which documents i have?', 'do i have any doc available?',
    'Show me all documents in this workspace', 'Are there any files available?'])
  ('answers a plain inventory question without Gemini tokens: %s', async query => {
    currentFiles = [source(), source('drive-two')];
    // A current Drive file can be listed before Gemini indexing completes.
    indexedDocs = [indexed()];
    const result = await service.searchDocuments(query, 'Olten', 'admin', 'gemini-test');
    expect(result).toMatchObject({ sourcesSearched: 2, cached: false });
    expect(result.answer).toContain('[dream.pdf](https://drive.google.com/file/d/drive-one/view)');
    expect(result.answer).toContain('[dream.pdf](https://drive.google.com/file/d/drive-two/view)');
    expect(gemini.createDocumentCache).not.toHaveBeenCalled();
    expect(gemini.askQuestion).not.toHaveBeenCalled();
    expect(prisma.searchHistory.create.mock.calls[0][0].data).toMatchObject({ query, promptTokens: 0, completionTokens: 0 });
  });

  it.each(['Which documents expire tomorrow?', 'Show me all documents about renewal',
    'Do I have any expired files?', 'Which files do I have that mention October?'])
  ('preserves Gemini analysis for a content question: %s', async query => {
    await service.searchDocuments(query, 'Olten', 'admin', 'gemini-test');
    expect(gemini.askQuestion).toHaveBeenCalledWith(query, expect.any(Array), 'cache-current', 'gemini-test');
  });

  it('reuses an identical answer briefly while verifying live sources and recording both searches', async () => {
    gemini.createDocumentCache.mockResolvedValue(null);
    expect(await search()).toMatchObject({ cached: false });
    expect(await service.searchDocuments(`  ${contentQuestion}  `, 'Olten', 'second-user', 'gemini-test'))
      .toMatchObject({ answer: 'Current files only', cached: true });
    expect(gemini.askQuestion).toHaveBeenCalledTimes(1);
    expect(drive.getCompanyDirectory).toHaveBeenCalledTimes(4);
    expect(prisma.searchHistory.create).toHaveBeenCalledTimes(2);
    expect(prisma.searchHistory.create.mock.calls[1][0].data).toMatchObject({ username: 'second-user',
      query: `  ${contentQuestion}  `, promptTokens: 0, completionTokens: 0 });
    jest.advanceTimersByTime(5 * 60 * 1000);
    await search();
    expect(gemini.askQuestion).toHaveBeenCalledTimes(2);
  });

  it('does not equate different letter case in content queries or share answers across companies', async () => {
    await search();
    await service.searchDocuments(contentQuestion.toUpperCase(), 'Olten', 'admin', 'gemini-test');
    indexedDocs = [indexed(1, 'drive-one', { company: 'Other' })];
    await search('Other');
    expect(gemini.askQuestion).toHaveBeenCalledTimes(3);
    expect(prisma.searchHistory.create.mock.calls[2][0].data.company).toBe('Other');
  });

  it('does not reuse a relative-date answer after the company calendar day changes', async () => {
    jest.setSystemTime(new Date('2026-10-05T15:59:00.000Z'));
    await search();
    jest.advanceTimersByTime(2 * 60 * 1000);
    await search();
    expect(gemini.askQuestion).toHaveBeenCalledTimes(2);
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(1);
  });

  it('shares simultaneous identical generation and records token usage only for its initiating search', async () => {
    let finish!: (value: any) => void;
    let started!: () => void;
    const generationStarted = new Promise<void>(resolve => { started = resolve; });
    gemini.askQuestion.mockImplementation(() => {
      started();
      return new Promise(resolve => { finish = resolve; });
    });
    const first = search();
    const second = service.searchDocuments(contentQuestion, 'Olten', 'second-user', 'gemini-test');
    await generationStarted;
    finish({ text: 'Shared answer', usage: { promptTokenCount: 12, candidatesTokenCount: 5 } });
    const results = await Promise.all([first, second]);
    expect(results.map(result => result.answer)).toEqual(['Shared answer', 'Shared answer']);
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(1);
    expect(gemini.askQuestion).toHaveBeenCalledTimes(1);
    expect(prisma.searchHistory.create).toHaveBeenCalledTimes(2);
    expect(prisma.searchHistory.create.mock.calls.map(call => call[0].data.promptTokens).sort()).toEqual([0, 12]);
  });

  it('shares context creation across simultaneous different questions', async () => {
    let finish!: (value: string) => void;
    let started!: () => void;
    const cacheStarted = new Promise<void>(resolve => { started = resolve; });
    gemini.createDocumentCache.mockImplementation(() => {
      started();
      return new Promise(resolve => { finish = resolve; });
    });
    const first = search();
    const second = service.searchDocuments('What is the license title?', 'Olten', 'admin', 'gemini-test');
    await cacheStarted;
    finish('shared-context');
    await Promise.all([first, second]);
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(1);
    expect(gemini.askQuestion).toHaveBeenCalledTimes(2);
    expect(gemini.askQuestion.mock.calls.map(call => call[2])).toEqual(['shared-context', 'shared-context']);
  });

  it('backs off unsupported context creation while continuing distinct uncached questions', async () => {
    gemini.createDocumentCache.mockResolvedValue(null);
    await search();
    await service.searchDocuments('What is the license title?', 'Olten', 'admin', 'gemini-test');
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(1);
    expect(gemini.askQuestion).toHaveBeenCalledTimes(2);
    expect(gemini.askQuestion.mock.calls.map(call => call[2])).toEqual([null, null]);
    jest.advanceTimersByTime(5 * 60 * 1000);
    await search();
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(2);
  });

  it('retries context creation promptly when the source or requested model changes', async () => {
    gemini.createDocumentCache.mockResolvedValue(null);
    await search();
    currentFiles = [source('drive-one', 'renamed.pdf')];
    await search();
    await search('Olten', 'gemini-other');
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(3);
    expect(gemini.askQuestion).toHaveBeenCalledTimes(3);
  });

  it.each(['modifiedTime', 'size', 'md5Checksum'])('regenerates an identical answer when live Drive %s changes', async field => {
    await search();
    currentFiles = [{ ...source(), [field]: 'new-content-metadata' }];
    await search();
    expect(gemini.askQuestion).toHaveBeenCalledTimes(2);
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(2);
  });

  it('does not return an old reused answer when its final live Drive check fails', async () => {
    await search();
    drive.getCompanyDirectory.mockResolvedValueOnce({ companyFolderId: 'company-root', folders: [], files: currentFiles })
      .mockRejectedValueOnce(new Error('Drive unavailable'));
    await expect(search()).rejects.toThrow('directory could not be verified');
    expect(gemini.askQuestion).toHaveBeenCalledTimes(1);
    expect(prisma.searchHistory.create).toHaveBeenCalledTimes(1);
    expect((service as any).searchAnswers.size).toBe(0);
  });

  it('never returns a reused answer after all sources have been deleted', async () => {
    await search();
    currentFiles = [];
    expect(await search()).toMatchObject({ answer: expect.stringContaining('No documents'), sourcesSearched: 0, cached: false });
    expect(gemini.askQuestion).toHaveBeenCalledTimes(1);
    expect((service as any).searchAnswers.size).toBe(0);
  });

  it('bounds retained answers and expires context failure entries', async () => {
    (service as any).maxSearchAnswers = 2;
    gemini.createDocumentCache.mockResolvedValue(null);
    await search();
    await service.searchDocuments('What is the first page title?', 'Olten', 'admin', 'gemini-test');
    await service.searchDocuments('What is the renewal period?', 'Olten', 'admin', 'gemini-test');
    expect((service as any).searchAnswers.size).toBe(2);
    await search();
    expect(gemini.askQuestion).toHaveBeenCalledTimes(4);
    expect((service as any).contextMisses.size).toBe(1);
    jest.advanceTimersByTime(5 * 60 * 1000);
    currentFiles = [];
    await search();
    expect((service as any).contextMisses.size).toBe(0);
  });

  it.each(['source ID', 'Gemini URI', 'Drive name', 'Drive link'])('rebuilds cached context when %s changes with the same file count', async change => {
    gemini.createDocumentCache.mockResolvedValueOnce('cache-before').mockResolvedValueOnce('cache-after');
    await search();
    if (change === 'source ID') {
      currentFiles = [source('drive-two')];
      indexedDocs = [indexed(2, 'drive-two')];
    } else if (change === 'Gemini URI') {
      indexedDocs = [indexed(1, 'drive-one', { geminiFileUri: 'replacement-index' })];
    } else if (change === 'Drive name') {
      currentFiles = [source('drive-one', 'renamed-license.pdf')];
    } else {
      currentFiles = [{ ...source(), webViewLink: 'https://drive.google.com/file/d/drive-one/view?usp=updated' }];
    }
    expect(await search()).toMatchObject({ sourcesSearched: 1, cached: true });
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(2);
    expect(gemini.askQuestion.mock.calls.map(call => call[2])).toEqual(['cache-before', 'cache-after']);
    if (change === 'Drive name') expect(gemini.askQuestion.mock.calls[1][1][0].name).toBe('renamed-license.pdf');
  });

  it('rebuilds cached context when the requested model changes', async () => {
    await search();
    await search('Olten', 'gemini-other');
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(2);
    expect(gemini.createDocumentCache.mock.calls[1][1]).toBe('gemini-other');
  });

  it('keeps both model contexts warm when switching models and asking another question', async () => {
    gemini.createDocumentCache.mockResolvedValueOnce('cache-first-model').mockResolvedValueOnce('cache-other-model');
    await search();
    await search('Olten', 'gemini-other');
    await service.searchDocuments('What is the document title?', 'Olten', 'admin', 'gemini-test');
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(2);
    expect(gemini.askQuestion.mock.calls.map(call => call[2])).toEqual([
      'cache-first-model', 'cache-other-model', 'cache-first-model',
    ]);
  });

  it('does not reuse a warm model context after its source metadata changes or its TTL expires', async () => {
    await search();
    await search('Olten', 'gemini-other');
    currentFiles = [{ ...source(), md5Checksum: 'replacement-content' }];
    await service.searchDocuments('What is the document title?', 'Olten', 'admin', 'gemini-test');
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(55 * 60 * 1000);
    await service.searchDocuments('What is the issue date?', 'Olten', 'admin', 'gemini-test');
    expect(gemini.createDocumentCache).toHaveBeenCalledTimes(4);
    expect((service as any).searchContexts.size).toBe(1);
  });

  it('clears every warm model context for the affected company when Drive becomes empty', async () => {
    await search();
    await search('Olten', 'gemini-other');
    expect((service as any).searchContexts.size).toBe(2);
    currentFiles = [];
    await search();
    expect((service as any).searchContexts.size).toBe(0);
  });

  it('discards the answer and history if the source is deleted while Gemini is responding', async () => {
    gemini.askQuestion.mockImplementation(async () => {
      currentFiles = [];
      return { text: 'You have dream.pdf' };
    });
    expect(await search()).toMatchObject({ answer: expect.stringContaining('documents changed'), sourcesChanged: true,
      sourcesSearched: 0, cached: false });
    expect(prisma.searchHistory.create).not.toHaveBeenCalled();
    expect((service as any).companyCache.has('Olten')).toBe(false);
  });

  it('discards an answer when its index changes during the request without changing file count', async () => {
    gemini.askQuestion.mockImplementation(async () => {
      indexedDocs = [indexed(1, 'drive-one', { geminiFileUri: 'new-index' })];
      return { text: 'Outdated analysis' };
    });
    expect(await search()).toMatchObject({ sourcesChanged: true, cached: false });
    expect(prisma.searchHistory.create).not.toHaveBeenCalled();
  });

  it('fails closed when Drive is unavailable and preserves other companies cache entries', async () => {
    const otherCache = { cacheName: 'other-company', expiresAt: Date.now() + 60000, model: 'gemini-test' };
    (service as any).companyCache.set('Olten', { ...otherCache, cacheName: 'old-deleted-files' });
    (service as any).companyCache.set('Other', otherCache);
    drive.getCompanyDirectory.mockRejectedValue(new Error('Drive unavailable'));
    await expect(search()).rejects.toThrow('directory could not be verified');
    expect(prisma.document.findMany).not.toHaveBeenCalled();
    expect(gemini.askQuestion).not.toHaveBeenCalled();
    expect(prisma.searchHistory.create).not.toHaveBeenCalled();
    expect((service as any).companyCache.has('Olten')).toBe(false);
    expect((service as any).companyCache.get('Other')).toBe(otherCache);
  });

  it('does not return or save the generated answer if the final Drive verification fails', async () => {
    drive.getCompanyDirectory.mockResolvedValueOnce({ companyFolderId: 'company-root', folders: [], files: currentFiles })
      .mockRejectedValueOnce(new Error('Drive unavailable'));
    await expect(search()).rejects.toThrow('directory could not be verified');
    expect(gemini.askQuestion).toHaveBeenCalledTimes(1);
    expect(prisma.searchHistory.create).not.toHaveBeenCalled();
    expect((service as any).companyCache.has('Olten')).toBe(false);
  });

  it('excludes another company and inactive index rows even when filenames and Drive IDs match', async () => {
    indexedDocs = [indexed(3, 'drive-one', { company: 'Other', geminiFileUri: 'private-other-index' }),
      indexed(2, 'drive-one', { status: 'DELETED', geminiFileUri: 'inactive-index' }), indexed()];
    await search();
    expect(gemini.askQuestion.mock.calls[0][1]).toHaveLength(1);
    expect(gemini.askQuestion.mock.calls[0][1][0].uri).toBe('gemini-uri-1');
    expect(drive.getCompanyDirectory.mock.calls).toEqual([['Olten'], ['Olten']]);
  });

  it('requires company context before reading or searching any documents', async () => {
    await expect(search('')).rejects.toThrow('Company header missing');
    expect(drive.getCompanyDirectory).not.toHaveBeenCalled();
    expect(prisma.document.findMany).not.toHaveBeenCalled();
    expect(gemini.askQuestion).not.toHaveBeenCalled();
  });
});

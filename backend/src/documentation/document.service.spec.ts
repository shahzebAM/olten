jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn() }));
jest.mock('./gemini.service', () => ({ GeminiService: jest.fn() }));
jest.mock('./drive.service', () => ({ DriveService: jest.fn() }));

import { PrismaClient } from '@prisma/client';
import { DocumentService } from './document.service';
import { ExpiryExtractorService } from './expiry-extractor.service';

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
      getCompanyDirectory: jest.fn(async () => ({ companyFolderId: 'company-root', folders: [], files: [] })),
      deleteFile: jest.fn(async () => undefined) };
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

  it('returns exact document and Drive IDs with source links for duplicate filenames', async () => {
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

  it('requires company context before deleting a document', async () => {
    await expect(service.deleteDocument('drive-permit', '')).rejects.toThrow('Company header missing');
    expect(drive.deleteFile).not.toHaveBeenCalled();
    expect(prisma.document.deleteMany).not.toHaveBeenCalled();
  });
});

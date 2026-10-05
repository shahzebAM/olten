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
      downloadFile: jest.fn(async () => Buffer.from('original PDF bytes')) };
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
    expect(result.reminderWarning).toContain('Enter a date');
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

  it('reactivates an inactive schedule when its untrusted date is confirmed', async () => {
    prisma.document.findFirst.mockResolvedValue({ ...doc(), expiryStatus: 'NEEDS_REVIEW', expiryConfidence: 0.5 });
    prisma.documentReminder.findUnique.mockResolvedValue({ expiryDate: date('2026-10-06'),
      triggerDate: date('2026-10-04'), status: 'FULFILLED' });
    await service.saveReminders([{ id: 1, expiryDate: '2026-10-06', reminderDays: 2 }], 'Olten');
    expect(prisma.documentReminder.upsert.mock.calls[0][0].update.status).toBe('PENDING');
    expect(prisma.document.update.mock.calls[0][0].data.expiryDetectionMethod).toBe('MANUAL');
  });

  it('confirms a legacy low-confidence date even when its stored status is stale', async () => {
    prisma.document.findFirst.mockResolvedValue({ ...doc(), expiryStatus: 'ACTIVE', expiryConfidence: 0.5 });
    prisma.documentReminder.findUnique.mockResolvedValue({ expiryDate: date('2026-10-06'),
      triggerDate: date('2026-10-04'), status: 'FULFILLED' });
    await service.saveReminders([{ id: 1, expiryDate: '2026-10-06', reminderDays: 2 }], 'Olten');
    expect(prisma.document.update.mock.calls[0][0].data).toMatchObject({ expiryDetectionMethod: 'MANUAL', expiryConfidence: 1 });
    expect(prisma.documentReminder.upsert.mock.calls[0][0].update.status).toBe('PENDING');
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

  it('updates a manual date and preserves the calendar-month reminder preference', async () => {
    prisma.documentReminder.findMany.mockResolvedValue([{ reminderType: 'MANUAL_MONTHS_2', reminderDays: 61 }]);
    prisma.document.findMany.mockResolvedValue([doc()]);
    const result = await service.updateManualExpiry('drive-permit', 'Olten', '2027-03-31');
    expect(result.reminder).toMatchObject({ reminderType: 'MANUAL_MONTHS_2', triggerDate: date('2027-01-31') });
    expect(result.expiryDetectionMethod).toBe('MANUAL');
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

  it('suppresses automatic rows when a fulfilled user schedule exists', async () => {
    prisma.document.findMany.mockResolvedValue([{ ...doc(), reminders: [
      { id: 11, reminderType: 'MANUAL', reminderDays: 2, status: 'FULFILLED' },
      { id: 12, reminderType: 'AUTO_DEFAULT_30', status: 'PENDING' },
    ] }]);
    expect(await service.getActiveNotifications('Olten')).toEqual([]);
  });
});

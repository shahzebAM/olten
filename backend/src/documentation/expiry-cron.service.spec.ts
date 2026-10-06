import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ExpiryCronService } from './expiry-cron.service';

// Scheduler decorators are unrelated to the database/calendar behavior exercised
// here. Its ESM package does not need to run in Jest's CommonJS test environment.
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: { EVERY_MINUTE: '* * * * *' },
}));

jest.mock('@prisma/client', () => {
  const client = {
    document: { findMany: jest.fn(), updateMany: jest.fn() },
    documentReminder: { upsert: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(async callback => callback(client)),
  };
  return { PrismaClient: jest.fn(() => client) };
});

const prisma = new PrismaClient() as any;
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const document = (overrides: Record<string, unknown> = {}) => ({
  id: 1, company: 'Olten', originalName: 'Permit.pdf', status: 'ACTIVE',
  expiryDate: date('2026-10-06'), expiryStatus: 'ACTIVE',
  expiryConfidence: 0.97, expiryDetectionMethod: 'GEMINI', reminders: [],
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides,
});

describe('ExpiryCronService', () => {
  let service: ExpiryCronService;
  const originalTimezone = process.env.DOCUMENT_EXPIRY_TIMEZONE;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-04T16:01:00.000Z'));
    process.env.DOCUMENT_EXPIRY_TIMEZONE = 'Asia/Manila';
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    prisma.document.findMany.mockResolvedValue([]);
    prisma.document.updateMany.mockResolvedValue({ count: 1 });
    prisma.documentReminder.upsert.mockResolvedValue({});
    prisma.documentReminder.updateMany.mockResolvedValue({ count: 0 });
    service = new ExpiryCronService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (originalTimezone === undefined) delete process.env.DOCUMENT_EXPIRY_TIMEZONE;
    else process.env.DOCUMENT_EXPIRY_TIMEZONE = originalTimezone;
  });

  it('reconciles active documents on startup and creates one durable default schedule', async () => {
    prisma.document.findMany.mockResolvedValue([document()]);
    await service.onModuleInit();
    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', expiryDate: { not: null } }, include: { reminders: true },
    });
    expect(prisma.document.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expiryStatus: 'EXPIRING_SOON' }),
    }));
    expect(prisma.documentReminder.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.documentReminder.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        documentId: 1, reminderType: 'AUTO_DEFAULT_30', status: 'PENDING',
        triggerDate: date('2026-09-06'), reminderDays: 30,
      }),
    }));
  });

  it.each(['PENDING', 'PROCESSING', 'FULFILLED'])('honors a configured reminder in %s state', async status => {
    prisma.document.findMany.mockResolvedValue([document({ reminders: [
      { reminderType: 'MANUAL_MONTHS_2', status, reminderDays: 61 },
      { reminderType: '90_DAYS', status: 'PENDING' },
    ] })]);
    await service.checkExpirations();
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
    expect(prisma.documentReminder.updateMany).toHaveBeenCalledWith({
      where: {
        documentId: 1, reminderType: { in: ['90_DAYS'] },
        status: { in: ['PENDING', 'PROCESSING'] },
      }, data: { status: 'FULFILLED' },
    });
  });

  it.each([
    { expiryStatus: 'NEEDS_REVIEW' },
    { expiryConfidence: 0.5 },
    { expiryDate: new Date(NaN) },
  ])('preserves uncertain expiry as NEEDS_REVIEW without generating an alert: %j', async overrides => {
    prisma.document.findMany.mockResolvedValue([document({ ...overrides, expiryDate: date('2026-10-03'), ...overrides })]);
    await service.checkExpirations();
    expect(prisma.document.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expiryStatus: 'NEEDS_REVIEW' }),
    }));
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it.each(['AWAITING_REMINDER', 'AWAITING_REMINDER_REVIEW', 'REMINDER_DISABLED', 'REMINDER_DISABLED_REVIEW'])
    ('preserves %s after expiry and server restart until reminder review is saved', async expiryStatus => {
      prisma.document.findMany.mockResolvedValue([document({
        expiryStatus, expiryDate: date('2026-10-03'),
        reminders: [{ reminderType: 'AUTO_DEFAULT_30', status: 'PENDING' }],
      })]);
      await service.onModuleInit();
      await service.checkExpirations();
      expect(prisma.document.updateMany).not.toHaveBeenCalled();
      expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
      expect(prisma.documentReminder.updateMany).not.toHaveBeenCalled();
    });

  it('checks previously expired documents so a renewed date can become active again', async () => {
    prisma.document.findMany.mockResolvedValue([document({ expiryStatus: 'EXPIRED', expiryDate: date('2027-01-01') })]);
    await service.checkExpirations();
    expect(prisma.document.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expiryStatus: 'ACTIVE' }),
    }));
  });

  it('does not reconcile the old source after a same-date replacement', async () => {
    const originalLink = 'https://drive.google.com/file/d/old-source/view';
    const original = document({ googleDriveLink: originalLink });
    prisma.document.findMany.mockResolvedValue([original]);
    prisma.document.updateMany.mockImplementation(async ({ where }) => {
      expect(where).toMatchObject({ id: original.id, googleDriveLink: originalLink,
        updatedAt: original.updatedAt, expiryDate: original.expiryDate });
      // The ID and expiry can remain the same while its source has changed.
      return { count: 0 };
    });
    await service.checkExpirations();
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
    expect(prisma.documentReminder.updateMany).not.toHaveBeenCalled();
  });

  it('uses Manila today and still creates an overdue reminder for an expired legacy document', async () => {
    prisma.document.findMany.mockResolvedValue([
      document({ expiryDate: date('2026-10-05') }),
      document({ id: 2, expiryDate: date('2026-10-04') }),
    ]);
    await service.checkExpirations();
    expect(prisma.document.updateMany.mock.calls[0][0].data.expiryStatus).toBe('EXPIRES_TODAY');
    expect(prisma.document.updateMany.mock.calls[1][0].data.expiryStatus).toBe('EXPIRED');
    expect(prisma.documentReminder.upsert.mock.calls[1][0].create.message)
      .toBe('Permit.pdf expired on 2026-10-04 (1 day ago).');
  });

  it.each([0, 90])('supports an explicit renewal lead time of %s days', async days => {
    prisma.document.findMany.mockResolvedValue([document({ renewalDaysBeforeExpiry: days })]);
    await service.checkExpirations();
    expect(prisma.documentReminder.upsert.mock.calls[0][0].create).toEqual(expect.objectContaining({
      reminderType: `AUTO_DEFAULT_${days}`, reminderDays: days,
    }));
  });

  it('retires legacy threshold fan-out and carries forward an acknowledged matching reminder', async () => {
    prisma.document.findMany.mockResolvedValue([document({ reminders: [
      { reminderType: '90_DAYS', expiryDate: date('2026-10-06'), status: 'PENDING' },
      { reminderType: '30_DAYS', expiryDate: date('2026-10-06'), status: 'FULFILLED' },
      { reminderType: '7_DAYS', expiryDate: date('2026-10-06'), status: 'PENDING' },
    ] })]);
    await service.checkExpirations();
    expect(prisma.documentReminder.upsert.mock.calls[0][0].create.status).toBe('FULFILLED');
    expect(prisma.documentReminder.updateMany.mock.calls[0][0].where.reminderType.in)
      .toEqual(['90_DAYS', '30_DAYS', '7_DAYS']);
  });

  it('does not resurrect an existing fulfilled automatic reminder for the same expiry', async () => {
    prisma.document.findMany.mockResolvedValue([document({ reminders: [
      { reminderType: 'AUTO_DEFAULT_30', expiryDate: date('2026-10-06'),
        triggerDate: date('2026-09-06'), status: 'FULFILLED' },
    ] })]);
    await service.checkExpirations();
    expect(prisma.documentReminder.upsert.mock.calls[0][0].update).not.toHaveProperty('status');
    expect(prisma.documentReminder.updateMany).not.toHaveBeenCalled();
  });

  it('reschedules a legacy automatic reminder when its document has a new expiry cycle', async () => {
    prisma.document.findMany.mockResolvedValue([document({ reminders: [
      { reminderType: 'AUTO_DEFAULT_30', expiryDate: date('2025-10-06'), status: 'FULFILLED' },
    ] })]);
    await service.checkExpirations();
    expect(prisma.documentReminder.upsert.mock.calls[0][0].update).toEqual(expect.objectContaining({
      expiryDate: date('2026-10-06'), triggerDate: date('2026-09-06'), status: 'PENDING',
    }));
  });

  it('isolates a failed document and continues checking the next one', async () => {
    prisma.document.findMany.mockResolvedValue([document(), document({ id: 2 })]);
    prisma.document.updateMany.mockRejectedValueOnce(new Error('one document failed'));
    await service.checkExpirations();
    expect(prisma.documentReminder.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.documentReminder.upsert.mock.calls[0][0].create.documentId).toBe(2);
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('document 1'));
  });

  it('allows startup after a database outage and retries successfully on the next tick', async () => {
    prisma.document.findMany.mockRejectedValueOnce(new Error('database offline'));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    prisma.document.findMany.mockResolvedValue([document()]);
    await service.checkExpirations();
    expect(prisma.documentReminder.upsert).toHaveBeenCalledTimes(1);
  });

  it('lets a concurrent document edit win over a stale cron snapshot', async () => {
    const doc = document();
    prisma.document.findMany.mockResolvedValue([doc]);
    prisma.document.updateMany.mockResolvedValueOnce({ count: 0 });
    await service.checkExpirations();
    expect(prisma.document.updateMany.mock.calls[0][0].where).toEqual({
      id: doc.id, status: 'ACTIVE', expiryDate: doc.expiryDate,
      expiryStatus: doc.expiryStatus, updatedAt: doc.updatedAt,
    });
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
  });

  it('does not create a default when the user clears a reminder after cron fetched the document', async () => {
    const doc = document();
    let currentStatus = doc.expiryStatus;
    prisma.document.findMany.mockImplementation(async () => {
      const fetched = { ...doc };
      currentStatus = 'REMINDER_DISABLED';
      return [fetched];
    });
    prisma.document.updateMany.mockImplementation(async ({ where }) => ({ count: where.expiryStatus === currentStatus ? 1 : 0 }));
    await service.checkExpirations();
    expect(prisma.documentReminder.upsert).not.toHaveBeenCalled();
    expect(currentStatus).toBe('REMINDER_DISABLED');
  });

  it('prevents overlapping checks from the startup hook and scheduled timer', async () => {
    let finish!: (documents: any[]) => void;
    prisma.document.findMany.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = service.onModuleInit();
    await service.checkExpirations();
    expect(prisma.document.findMany).toHaveBeenCalledTimes(1);
    finish([]);
    await pending;
  });
});

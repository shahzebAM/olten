import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import {
  companyToday,
  DEFAULT_REMINDER_DAYS,
  expiryStatus,
  parseIsoDate,
  reminderMessage,
  reminderSchedule,
} from './expiry-date.utils';

const prisma = new PrismaClient();

const isAutomaticReminder = (type: string | null | undefined) =>
  typeof type === 'string' &&
  (/^AUTO_DEFAULT_\d+$/.test(type) || /^\d+_DAYS$/.test(type) || type === 'EXPIRED');

@Injectable()
export class ExpiryCronService implements OnModuleInit {
  private readonly logger = new Logger(ExpiryCronService.name);
  private checkInProgress = false;

  async onModuleInit() {
    // Reconcile missed dates as soon as the server starts, including after downtime.
    await this.checkExpirations();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkExpirations() {
    if (this.checkInProgress) return;
    this.checkInProgress = true;

    try {
      const today = companyToday();
      const documents = await (prisma as any).document.findMany({
        where: { status: 'ACTIVE', expiryDate: { not: null } },
        include: { reminders: true },
      });

      for (const doc of documents) {
        try {
          // Updating the document holds its row lock until the schedule is saved.
          // User edits update that same row before saving their reminder, so the
          // status and schedule cannot be reconciled from different date cycles.
          await (prisma as any).$transaction(
            (client: any) => this.reconcileDocument(doc, today, client),
            { timeout: 10000 },
          );
        } catch (error: any) {
          this.logger.error(`Could not check expiry for document ${doc.id}: ${error.message}`);
        }
      }
    } catch (error: any) {
      // Database/configuration failures must not prevent Nest from starting.
      this.logger.error(`Document expiry check failed: ${error.message}`);
    } finally {
      this.checkInProgress = false;
    }
  }

  private async reconcileDocument(doc: any, today: Date, client: any) {
    // Uploads in the review-first flow stay unscheduled until the user saves
    // their chosen reminder. Preserve that durable state across cron ticks and
    // restarts, including when the detected expiry has already passed.
    if (typeof doc.expiryStatus === 'string' &&
      (doc.expiryStatus.startsWith('AWAITING_REMINDER') ||
        doc.expiryStatus === 'REMINDER_DISABLED' || doc.expiryStatus === 'REMINDER_DISABLED_REVIEW')) return;

    const date = parseIsoDate(doc.expiryDate);
    const needsReview = !date || doc.expiryStatus === 'NEEDS_REVIEW' ||
      (doc.expiryDetectionMethod !== 'MANUAL' &&
        typeof doc.expiryConfidence === 'number' && doc.expiryConfidence < 0.85);

    const refreshed = await client.document.updateMany({
      where: {
        id: doc.id,
        status: 'ACTIVE',
        expiryDate: doc.expiryDate,
        expiryStatus: doc.expiryStatus,
        ...(doc.googleDriveLink !== undefined ? { googleDriveLink: doc.googleDriveLink } : {}),
        ...(doc.updatedAt ? { updatedAt: doc.updatedAt } : {}),
      },
      data: {
        expiryStatus: expiryStatus(date, needsReview, today),
        lastExpiryCheck: new Date(),
      },
    });

    // A document changed since the query (for example, the user confirmed its
    // date). Let the next check use the new values instead of overwriting them.
    if (!refreshed.count || !date || needsReview) return;

    const reminders: any[] = doc.reminders || [];
    const automatic = reminders.filter(rem => isAutomaticReminder(rem.reminderType));
    // A completed user reminder still represents their chosen schedule. Never add a
    // fresh default after they have dismissed or fulfilled that reminder.
    if (reminders.some(rem => !isAutomaticReminder(rem.reminderType))) {
      await this.retireAutomaticReminders(doc.id, automatic, client);
      return;
    }

    const configuredDays = doc.renewalDaysBeforeExpiry;
    const days = Number.isSafeInteger(configuredDays) && configuredDays >= 0 && configuredDays <= 36500
      ? configuredDays : DEFAULT_REMINDER_DAYS;
    const schedule = reminderSchedule(date, { value: days, unit: 'days' });
    const reminderType = `AUTO_DEFAULT_${days}`;
    const current = automatic.find(rem => rem.reminderType === reminderType);
    const previousCycle = current && parseIsoDate(current.expiryDate)?.getTime() !== date.getTime();
    // Preserve a previously acknowledged legacy alert when replacing the old
    // threshold fan-out with the single corresponding automatic reminder.
    const legacyType = days === 0 ? 'EXPIRED' : `${days}_DAYS`;
    const legacy = automatic.find(rem => rem.reminderType === legacyType &&
      parseIsoDate(rem.expiryDate)?.getTime() === date.getTime());
    const data = {
      company: doc.company,
      fileName: doc.originalName,
      title: 'Document Expiry Reminder',
      message: reminderMessage(doc.originalName, date, today),
      expiryDate: date,
      triggerDate: schedule.triggerDate,
      reminderDays: schedule.reminderDays,
    };

    await client.documentReminder.upsert({
      where: { documentId_reminderType: { documentId: doc.id, reminderType } },
      update: { ...data, ...(previousCycle ? { status: 'PENDING' } : {}) },
      create: {
        ...data,
        documentId: doc.id,
        reminderType,
        status: legacy?.status || 'PENDING',
      },
    });
    await this.retireAutomaticReminders(doc.id,
      automatic.filter(rem => rem.reminderType !== reminderType), client);
  }

  private async retireAutomaticReminders(documentId: number, reminders: any[], client: any) {
    if (reminders.length === 0) return;
    await client.documentReminder.updateMany({
      where: {
        documentId,
        reminderType: { in: reminders.map(rem => rem.reminderType) },
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      data: { status: 'FULFILLED' },
    });
  }
}

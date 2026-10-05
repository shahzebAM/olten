import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class ExpiryCronService {
  private readonly logger = new Logger(ExpiryCronService.name);
  
  // Configurable reminder thresholds (in days)
  private readonly defaultReminders = [90, 60, 30, 14, 7, 3, 1, 0];

  @Cron('0 8 * * *') // Runs every day at 8:00 AM server time
  async checkExpirations() {
    this.logger.log('Starting daily document expiration check...');
    
    // 1. Load active documents containing an expiry date
    const documents = await (prisma as any).document.findMany({
      where: {
        expiryDate: { not: null },
        expiryStatus: { not: 'EXPIRED' }
      }
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (const doc of documents) {
      const expiryDate = new Date(doc.expiryDate);
      expiryDate.setUTCHours(0, 0, 0, 0);

      // 2. Calculate remaining calendar days accurately
      const diffTime = expiryDate.getTime() - today.getTime();
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // 3. Update the expiry status based on days remaining
      let newStatus = doc.expiryStatus;
      if (daysRemaining < 0) newStatus = 'EXPIRED';
      else if (daysRemaining === 0) newStatus = 'EXPIRES_TODAY';
      else if (daysRemaining <= 30 && doc.expiryStatus !== 'NEEDS_REVIEW') newStatus = 'EXPIRING_SOON';
      else if (doc.expiryStatus !== 'NEEDS_REVIEW') newStatus = 'ACTIVE';

      if (newStatus !== doc.expiryStatus) {
        await (prisma as any).document.update({
          where: { id: doc.id },
          data: { expiryStatus: newStatus, lastExpiryCheck: new Date() }
        });
      }

      // 4. Generate notifications when a configured threshold is reached
      const applicableReminders = [...this.defaultReminders];
      if (doc.renewalDaysBeforeExpiry && !applicableReminders.includes(doc.renewalDaysBeforeExpiry)) {
        applicableReminders.push(doc.renewalDaysBeforeExpiry);
      }

      for (const days of applicableReminders) {
        // If we have reached or passed the exact threshold mark (e.g. 29 days remaining triggers the 30-day alert)
        if (daysRemaining <= days && daysRemaining >= 0) {
          const type = days === 0 ? 'EXPIRED' : `${days}_DAYS`;
          const title = days === 0 ? 'Document Expiring Today' : 'Document Expiry Reminder';
          const message = days === 0 
            ? `${doc.originalName} expires today (${expiryDate.toISOString().split('T')[0]}).`
            : `${doc.originalName} will expire on ${expiryDate.toISOString().split('T')[0]}. ${daysRemaining} days remaining.`;

          // 6. Avoid duplicate notifications using Prisma upsert and the compound unique key
          await (prisma as any).documentReminder.upsert({
            where: {
              documentId_reminderType: {
                documentId: doc.id,
                reminderType: type
              }
            },
            update: {}, // No-op if it already exists
            create: {
              documentId: doc.id,
              company: doc.company,
              fileName: doc.originalName,
              title: title,
              message: message,
              reminderType: type,
              expiryDate: expiryDate,
              triggerDate: today,
              reminderDays: days,
              status: 'PENDING'
            }
          });
        }
      }
    }
    this.logger.log('Daily expiration check completed successfully.');
  }
}
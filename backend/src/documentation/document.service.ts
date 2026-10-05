import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { GeminiService } from './gemini.service';
import { DriveService } from './drive.service';
import { ExpiryExtractorService } from './expiry-extractor.service';
import type { ExtractedExpiry } from './expiry-extractor.service';
import { choiceFromReminder, companyToday, daysBetween, expiryStatus, parseIsoDate, readReminderChoice, reminderMessage, reminderSchedule } from './expiry-date.utils';
import type { ReminderChoice, ReminderOptions } from './expiry-date.utils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const prisma = new PrismaClient();

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private companyCache: Map<string, { cacheName: string, expiresAt: number, model: string }> = new Map();

  constructor(
    private geminiService: GeminiService,
    private driveService: DriveService,
    private expiryExtractor: ExpiryExtractorService
  ) {}

  private requireCompany(company: string) {
    if (!company?.trim()) throw new BadRequestException('Company header missing');
  }

  private driveId(link?: string | null): string | null {
    if (!link) return null;
    try {
      const url = new URL(link);
      return url.pathname.match(/\/d\/([^/]+)/)?.[1] || url.searchParams.get('id');
    } catch { return null; }
  }

  private async findDocument(id: string | number, company: string, client: any = prisma) {
    this.requireCompany(company);
    const textId = String(id);
    if (!/^[\w-]+$/.test(textId)) throw new BadRequestException('Invalid document ID');
    let doc: any = null;
    if (/^\d+$/.test(textId) && Number.isSafeInteger(Number(textId)) && Number(textId) <= 2147483647) {
      doc = await client.document.findFirst({ where: { id: Number(textId), company } });
    }
    if (!doc) {
      const candidates = await client.document.findMany({ where: { company, googleDriveLink: { contains: textId } } });
      doc = candidates.find((item: any) => this.driveId(item.googleDriveLink) === textId);
    }
    if (!doc) throw new NotFoundException('Document not found in this company');
    return doc;
  }

  private configuredReminder(reminders: any[]): any | undefined {
    return reminders.find(rem => rem.reminderType?.startsWith('MANUAL'))
      || reminders.find(rem => !this.isAutomaticReminder(rem.reminderType));
  }

  private isAutomaticReminder(type?: string | null) {
    return !!type && (/^\d+_DAYS$/.test(type) || type === 'EXPIRED' || type.startsWith('AUTO_DEFAULT_'));
  }

  private needsExpiryReview(doc: any) {
    return doc.expiryStatus === 'NEEDS_REVIEW' || doc.expiryStatus === 'AWAITING_REMINDER_REVIEW'
      || doc.expiryDetectionMethod !== 'MANUAL' && typeof doc.expiryConfidence === 'number' && doc.expiryConfidence < 0.85;
  }

  private isReminderSetupPending(doc: any) {
    return typeof doc.expiryStatus === 'string' && doc.expiryStatus.startsWith('AWAITING_REMINDER');
  }

  private expiryPayload(doc: any) {
    const expiry = parseIsoDate(doc.expiryDate);
    return { ...doc, expiryStatus: expiryStatus(expiry, this.needsExpiryReview(doc)),
      reminderSetupPending: this.isReminderSetupPending(doc),
      daysRemaining: expiry ? daysBetween(expiry, companyToday()) : null };
  }

  private serializeReminder(rem: any, today = companyToday()) {
    const expiry = parseIsoDate(rem.expiryDate)!;
    const choice = choiceFromReminder(rem);
    const trigger = parseIsoDate(rem.triggerDate) || reminderSchedule(expiry, choice).triggerDate;
    return { ...rem, triggerDate: trigger, reminderValue: choice.value, reminderUnit: choice.unit,
      daysRemaining: daysBetween(expiry, today),
      message: reminderMessage(rem.fileName, expiry, today),
      isTriggered: today >= trigger && ['PENDING', 'PROCESSING'].includes(rem.status) };
  }

  private reminderWarning(doc: any) {
    if (this.needsExpiryReview(doc)) return 'The detected expiry is uncertain. Re-analyze a clearer document before setting a reminder.';
    if (!doc.expiryDate) return 'No expiry date was detected. Re-analyze or upload a clearer document to activate a reminder.';
    if (this.isReminderSetupPending(doc)) return 'Choose and save your reminder after upload.';
    return undefined;
  }

  private async persistReminder(client: any, doc: any, choice: ReminderChoice, forcePending = false) {
    const expiry = parseIsoDate(doc.expiryDate);
    if (!expiry) throw new BadRequestException('A valid expiry date is required to schedule a reminder.');
    const schedule = reminderSchedule(expiry, choice);
    const key = { documentId: doc.id, reminderType: schedule.reminderType };
    const previous = await client.documentReminder.findUnique({ where: { documentId_reminderType: key } });
    const changed = !previous || parseIsoDate(previous.expiryDate)?.getTime() !== expiry.getTime()
      || parseIsoDate(previous.triggerDate)?.getTime() !== schedule.triggerDate.getTime();
    const data = { company: doc.company, fileName: doc.originalName || doc.filename,
      expiryDate: expiry, ...schedule, title: 'Document Expiry Reminder',
      message: reminderMessage(doc.originalName || doc.filename, expiry) };
    // A document has one user-selected schedule; older automatic thresholds are superseded.
    await client.documentReminder.deleteMany({ where: { documentId: doc.id,
      OR: [{ reminderType: { not: schedule.reminderType } }, { reminderType: null }] } });
    const reminder = await client.documentReminder.upsert({
      where: { documentId_reminderType: key },
      create: { documentId: doc.id, ...data, status: 'PENDING' },
      update: { ...data, ...(changed || forcePending ? { status: 'PENDING' } : {}) },
    });
    return this.serializeReminder(reminder);
  }

  async getCompanyDirectory(company: string) {
    this.requireCompany(company);
    const [directory, docs] = await Promise.all([
      this.driveService.getCompanyDirectory(company),
      prisma.document.findMany({ where: { company }, include: { reminders: true } }),
    ]);
    const byDriveId = new Map(docs.map(doc => [this.driveId(doc.googleDriveLink), doc]));
    return { ...directory, files: directory.files.map((file: any) => {
      const doc = byDriveId.get(file.id);
      if (!doc) return file;
      const reminder = this.isReminderSetupPending(doc) ? undefined : this.configuredReminder(doc.reminders) || doc.reminders[0];
      const payload = this.expiryPayload(doc);
      return { ...file, documentId: doc.id, documentType: doc.documentType, documentNumber: doc.documentNumber,
        expiryDate: doc.expiryDate, expiryStatus: payload.expiryStatus, expiryDateText: doc.expiryDateText,
        daysRemaining: payload.daysRemaining, reminderSetupPending: payload.reminderSetupPending,
        expiryDetectionMethod: doc.expiryDetectionMethod, expiryConfidence: doc.expiryConfidence,
        reminder: reminder ? this.serializeReminder(reminder) : null, reminderWarning: this.reminderWarning(doc) };
    }) };
  }

  async createFolder(company: string, folderName: string) {
    this.requireCompany(company);
    return this.driveService.createSubFolder(company, folderName);
  }

  async processNewDocument(file: any, company: string, username: string, targetFolderId?: string, options: ReminderOptions = {}) {
    this.requireCompany(company);
    if (!Buffer.isBuffer(file?.buffer) || !file.buffer.length) throw new BadRequestException('An empty file cannot be uploaded');
    const choice = readReminderChoice(options);
    if (options.reminderSetup !== undefined && options.reminderSetup !== 'after-upload') throw new BadRequestException('Invalid reminder setup mode');
    const setupAfterUpload = options.reminderSetup === 'after-upload';
    const safeMimeType = this.geminiService.normalizeMimeType(file.mimetype, file.originalname);
    const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'olten-doc-'));
    const tempFilePath = path.join(tempDirectory, `upload${path.extname(file.originalname)}`);
    let driveLink: string | undefined;
    let geminiData: { fileUri?: string; fileId?: string; mimeType?: string } = {};
    let finalExpiryData: ExtractedExpiry | null = null;
    let detectionWarning: string | undefined;
    let indexingWarning: string | undefined;
    try {
      await fs.promises.writeFile(tempFilePath, file.buffer);
      const indexedFile = this.geminiService.uploadFileToGemini(tempFilePath, safeMimeType, file.originalname);
      const [driveResult, geminiResult, expiryResult] = await Promise.allSettled([
        this.driveService.uploadFileToDrive(file.buffer, safeMimeType, file.originalname, company, targetFolderId),
        indexedFile,
        this.geminiService.extractStructuredExpiry(file.buffer, safeMimeType, file.originalname, indexedFile),
      ]);
      if (geminiResult.status === 'fulfilled') geminiData = geminiResult.value;
      else indexingWarning = 'The file was saved, but Gemini search indexing failed.';
      if (driveResult.status === 'rejected') {
        if (geminiData.fileId) await this.geminiService.deleteGeminiFile(geminiData.fileId).catch(() => undefined);
        throw new BadRequestException(`Upload failed: ${driveResult.reason?.message || 'Google Drive upload failed'}`);
      }
      driveLink = driveResult.value;
      if (expiryResult.status === 'fulfilled') finalExpiryData = expiryResult.value;
      else {
        detectionWarning = `Expiry detection failed: ${expiryResult.reason?.message || 'Gemini could not analyze this file'}. Re-analyze or upload a clearer document.`;
        this.logger.warn(`Expiry analysis failed for ${file.originalname}`);
        if (safeMimeType.startsWith('text/')) {
          finalExpiryData = this.expiryExtractor.extractViaRegex(file.buffer.toString('utf8'));
          if (finalExpiryData) finalExpiryData.confidence = Math.min(finalExpiryData.confidence, 0.84);
        }
      }
      return await prisma.$transaction(async client => {
        const doc = await client.document.create({ data: {
          filename: file.originalname, originalName: file.originalname, mimeType: geminiData.mimeType || safeMimeType,
          sizeBytes: file.buffer.length, company, uploadedBy: username || 'Anonymous', googleDriveLink: driveLink,
          geminiFileUri: geminiData.fileUri, geminiFileId: geminiData.fileId, status: 'ACTIVE',
          documentType: finalExpiryData?.documentType, documentNumber: finalExpiryData?.documentNumber,
          issueDate: finalExpiryData?.issueDate, expiryDate: finalExpiryData?.expiryDate,
          renewalDate: finalExpiryData?.renewalDate, renewalDaysBeforeExpiry: finalExpiryData?.renewalDaysBeforeExpiry,
          expiryDateText: finalExpiryData?.expiryDateText, expiryConfidence: finalExpiryData?.confidence,
          expiryDetectionMethod: finalExpiryData?.method,
          expiryStatus: setupAfterUpload
            ? (!!detectionWarning || !!finalExpiryData?.expiryDate && finalExpiryData.confidence < 0.85 ? 'AWAITING_REMINDER_REVIEW' : 'AWAITING_REMINDER')
            : expiryStatus(finalExpiryData?.expiryDate || null, !!detectionWarning || !!finalExpiryData?.expiryDate && finalExpiryData.confidence < 0.85),
          lastExpiryCheck: new Date(),
        } });
        const reminder = !setupAfterUpload && doc.expiryDate && !this.needsExpiryReview(doc) ? await this.persistReminder(client, doc, choice) : null;
        this.companyCache.delete(company);
        return { ...this.expiryPayload(doc), reminder, reminderWarning: this.reminderWarning(doc), detectionWarning, indexingWarning };
      }, { timeout: 15000 });
    } catch (error: any) {
      // Roll back remote copies if saving the document/reminder transaction fails.
      const uploadedDriveId = this.driveId(driveLink);
      await Promise.allSettled([
        ...(uploadedDriveId ? [this.driveService.deleteFile(uploadedDriveId)] : []),
        ...(geminiData.fileId && driveLink ? [this.geminiService.deleteGeminiFile(geminiData.fileId)] : []),
      ]);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('The document and reminder could not be saved. Please retry the upload.');
    } finally {
      await fs.promises.unlink(tempFilePath).catch(() => undefined);
      await fs.promises.rmdir(tempDirectory).catch(() => undefined);
    }
  }

  // Retain the old endpoint for reminder settings, but the source date is immutable.
  async updateManualExpiry(documentId: string | number, company: string, newDate: string | undefined, options: ReminderOptions = {}) {
    this.requireCompany(company);
    return prisma.$transaction(async client => {
      const doc = await this.findDocument(documentId, company, client);
      const { updated, reminder } = await this.saveStoredReminder(client, doc, options, newDate);
      return { ...this.expiryPayload(updated), reminder };
    }, { timeout: 15000 });
  }

  private async saveStoredReminder(client: any, doc: any, options: ReminderOptions, submittedDate?: unknown) {
    const date = parseIsoDate(doc.expiryDate);
    if (doc.status !== 'ACTIVE' || !date || this.needsExpiryReview(doc)) {
      throw new BadRequestException('A reliable expiry date must be detected from the document before a reminder can be saved. Re-analyze or upload a clearer document.');
    }
    if (submittedDate !== undefined && parseIsoDate(submittedDate)?.getTime() !== date.getTime()) {
      throw new BadRequestException('Expiry dates are detected from the document and cannot be edited. Refresh to use the current detected date.');
    }
    const reminders = await client.documentReminder.findMany({ where: { documentId: doc.id } });
    const previous = this.configuredReminder(reminders) || reminders[0];
    const choice = readReminderChoice(options, previous ? choiceFromReminder(previous) : undefined);
    let updated: any;
    try {
      // This guarded update locks the document before writing its schedule. An
      // analysis that changed the date or trust since validation must win.
      updated = await client.document.update({ where: {
        id: doc.id, company: doc.company, status: doc.status,
        expiryDate: doc.expiryDate, expiryStatus: doc.expiryStatus,
        expiryDetectionMethod: doc.expiryDetectionMethod, expiryConfidence: doc.expiryConfidence,
      }, data: { expiryStatus: expiryStatus(date), lastExpiryCheck: new Date() } });
    } catch (error: any) {
      if (error.code === 'P2025') throw new BadRequestException('The detected expiry changed while saving. Refresh the document and choose your reminder again.');
      throw error;
    }
    const reminder = await this.persistReminder(client, updated, choice, this.isReminderSetupPending(doc));
    return { updated, reminder };
  }

  private async extractStoredDocument(doc: any) {
    const driveId = this.driveId(doc.googleDriveLink);
    if (driveId) {
      const buffer = await this.driveService.downloadFile(driveId);
      return this.geminiService.extractStructuredExpiry(buffer, doc.mimeType, doc.originalName || doc.filename);
    }
    if (doc.geminiFileUri) return this.geminiService.extractStructuredExpiryFromUri(doc.geminiFileUri, doc.mimeType);
    throw new BadRequestException('The original document is unavailable for analysis.');
  }

  private async applyAnalysis(doc: any, data: ExtractedExpiry | null) {
    return prisma.$transaction(async client => {
      // A date confirmed while Gemini was working must win. Ignore harmless cron
      // timestamps, but require the original expiry and trust values to match.
      const updated = await client.document.update({ where: { id: doc.id, company: doc.company,
        status: doc.status, expiryDate: doc.expiryDate, expiryDetectionMethod: doc.expiryDetectionMethod,
        expiryConfidence: doc.expiryConfidence,
        // Saving a reliable detected date can keep its date and confidence while
        // clearing setup. That confirmation must also beat a pending analysis.
        ...(this.isReminderSetupPending(doc) ? { expiryStatus: doc.expiryStatus } : {}) }, data: {
        expiryDate: data?.expiryDate || null, documentType: data?.documentType || null,
        documentNumber: data?.documentNumber || null, issueDate: data?.issueDate || null,
        renewalDate: data?.renewalDate || null, renewalDaysBeforeExpiry: data?.renewalDaysBeforeExpiry ?? null,
        expiryDateText: data?.expiryDateText || null, expiryConfidence: data?.confidence ?? null,
        expiryDetectionMethod: data?.method || 'GEMINI',
        expiryStatus: this.isReminderSetupPending(doc)
          ? (!!data?.expiryDate && data.confidence < 0.85 ? 'AWAITING_REMINDER_REVIEW' : 'AWAITING_REMINDER')
          : expiryStatus(data?.expiryDate || null, !!data?.expiryDate && data.confidence < 0.85),
        lastExpiryCheck: new Date(),
      } });
      const reminders = await client.documentReminder.findMany({ where: { documentId: doc.id } });
      const previous = this.configuredReminder(reminders) || reminders[0];
      let reminder: any = null;
      if (!this.isReminderSetupPending(updated) && updated.expiryDate && !this.needsExpiryReview(updated)) {
        reminder = await this.persistReminder(client, updated, previous ? choiceFromReminder(previous) : readReminderChoice(), this.needsExpiryReview(doc) || !doc.expiryDate);
      } else {
        // Keep the user's chosen lead time for a later corrected date, but stop stale alerts.
        await client.documentReminder.updateMany({ where: { documentId: doc.id }, data: { status: 'FULFILLED' } });
      }
      return { ...this.expiryPayload(updated), reminder, reminderWarning: this.reminderWarning(updated) };
    }, { timeout: 15000 });
  }

  async reanalyzeDocument(documentId: string | number, company: string) {
    const doc = await this.findDocument(documentId, company);
    try {
      const analysis = await this.extractStoredDocument(doc);
      return await this.applyAnalysis(doc, analysis);
    } catch (error: any) {
      if (error.code === 'P2025') throw new BadRequestException('The expiry changed while Gemini was analyzing it. Your current expiry and reminder were preserved. Reanalyze again if needed.');
      throw new BadRequestException(`Expiry analysis failed: ${error.message}. Your current expiry and reminder were preserved.`);
    }
  }

  async analyzeExpiryDates(fileIds: any[], company: string) {
    this.requireCompany(company);
    const results: Record<string, string> = {};
    const ids = new Set(fileIds.map(String));
    const docs = await prisma.document.findMany({ where: { company, status: 'ACTIVE' } });
    for (const doc of docs.filter(item => ids.has(String(item.id)) || ids.has(this.driveId(item.googleDriveLink) || ''))) {
      try {
        const updated = await this.applyAnalysis(doc, await this.extractStoredDocument(doc));
        if (updated.expiryDate) results[String(doc.id)] = updated.expiryDate.toISOString().slice(0, 10);
      } catch (error: any) {
        this.logger.warn(`Expiry analysis failed for document ${doc.id}: ${error.message}`);
      }
    }
    return results;
  }

  async saveReminders(reminders: any[], company: string) {
    this.requireCompany(company);
    if (!reminders.length) throw new BadRequestException('No reminders were provided');
    const saved = await prisma.$transaction(async client => {
      const seen = new Set<number>();
      const results: any[] = [];
      for (const rem of reminders) {
        if (!rem || typeof rem !== 'object') throw new BadRequestException('Invalid reminder');
        const doc = await this.findDocument(rem.id, company, client);
        if (seen.has(doc.id)) throw new BadRequestException('Duplicate document in reminders');
        seen.add(doc.id);
        const { reminder } = await this.saveStoredReminder(client, doc, rem, rem.expiryDate);
        results.push(reminder);
      }
      return results;
    }, { timeout: 15000 });
    return { success: true, count: saved.length, reminders: saved };
  }

  async getActiveNotifications(company: string) {
    this.requireCompany(company);
    const today = companyToday();
    const docs = await prisma.document.findMany({ where: { company, status: 'ACTIVE' }, include: { reminders: true } });
    return docs.flatMap(doc => {
      if (this.isReminderSetupPending(doc) || this.needsExpiryReview(doc) || !doc.expiryDate) return [];
      const configured = this.configuredReminder(doc.reminders);
      return doc.reminders.filter(rem => ['PENDING', 'PROCESSING'].includes(rem.status)
        && parseIsoDate(rem.expiryDate)?.getTime() === parseIsoDate(doc.expiryDate)?.getTime()
        && (!configured || !this.isAutomaticReminder(rem.reminderType)))
        .map(rem => ({ ...this.serializeReminder(rem, today), documentId: doc.id,
          driveFileId: this.driveId(doc.googleDriveLink), sourceUrl: doc.googleDriveLink,
          expiryDateText: doc.expiryDateText }));
    }).sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }

  async updateNotificationStatus(reminderId: number, newStatus: string, company: string) {
    this.requireCompany(company);
    if (!Number.isSafeInteger(reminderId) || reminderId <= 0 || reminderId > 2147483647) throw new BadRequestException('Invalid reminder ID');
    if (!['PENDING', 'PROCESSING', 'FULFILLED'].includes(newStatus)) throw new BadRequestException('Invalid reminder status');
    const result = await prisma.documentReminder.updateMany({ where: { id: reminderId, company }, data: { status: newStatus } });
    if (!result.count) throw new NotFoundException('Reminder not found in this company');
    return { success: true };
  }

  async searchDocuments(query: string, company: string, username: string, requestedModel?: string) {
    try {
      const docs = await (prisma as any).document.findMany({
        where: { company, status: 'ACTIVE' },
      });

      if (!docs || docs.length === 0) throw new Error(`No active documents found for ${company}.`);

      const filesData = docs
        .filter((d: any) => typeof d.geminiFileUri === 'string' && d.geminiFileUri.length > 0)
        .map((d: any) => ({
          uri: d.geminiFileUri,
          mimeType: d.mimeType || 'application/pdf',
          name: d.filename || 'Unknown Document',
          driveLink: d.googleDriveLink || 'No link available',
        }));

      if (filesData.length === 0) throw new Error('Documents exist, but have not finished indexing in Gemini.');

      const targetModel = requestedModel || process.env.GEMINI_MODEL || 'gemini-3.6-flash';
      let cacheName: string | null = null;
      let cacheInfo = this.companyCache.get(company);

      if (!cacheInfo || Date.now() > cacheInfo.expiresAt || cacheInfo.model !== targetModel) {
        const newCacheName = await this.geminiService.createDocumentCache(filesData, targetModel);
        if (newCacheName) {
          cacheInfo = { cacheName: newCacheName, expiresAt: Date.now() + (55 * 60 * 1000), model: targetModel };
          this.companyCache.set(company, cacheInfo);
          cacheName = newCacheName;
        }
      } else {
        cacheName = cacheInfo.cacheName;
      }

      const answer = await this.geminiService.askQuestion(query, filesData, cacheName, targetModel);
      const responseText = answer.text || 'No response generated.';

      try {
        await (prisma as any).searchHistory.create({
          data: {
            username: username || 'Anonymous',
            company: company,
            query: query,
            response: responseText,
            modelUsed: targetModel,
            promptTokens: answer.usage?.promptTokenCount || 0,
            completionTokens: answer.usage?.candidatesTokenCount || 0,
          },
        });
      } catch (dbError) {}

      return { answer: responseText, model: targetModel, sourcesSearched: filesData.length, cached: !!cacheName };
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  async deleteDocument(id: string | number, company: string) {
    this.requireCompany(company);
    const textId = String(id);
    if (!/^[\w-]+$/.test(textId)) throw new BadRequestException('Invalid document ID');
    let indexed: any = null;
    try { indexed = await this.findDocument(id, company); }
    catch (error) { if (!(error instanceof NotFoundException)) throw error; }

    const driveIds = new Set<string>();
    let targetDriveId = indexed ? this.driveId(indexed.googleDriveLink) : null;
    if (targetDriveId) {
      driveIds.add(targetDriveId);
    } else if (!indexed) {
      // Drive-only files and folders are authorized by exact membership beneath
      // this company's root, never by a filename or a partial link match.
      const directory = await this.driveService.getCompanyDirectory(company);
      const items = [...directory.folders, ...directory.files];
      const target = items.find(item => item.id === textId);
      if (!target) throw new NotFoundException('Document not found in this company');
      targetDriveId = target.id;
      driveIds.add(target.id);
      if (target.mimeType === 'application/vnd.google-apps.folder') {
        const pending = [target.id];
        for (let i = 0; i < pending.length; i++) {
          for (const item of items.filter(item => item.parents?.includes(pending[i]))) {
            if (driveIds.has(item.id)) continue;
            driveIds.add(item.id);
            if (item.mimeType === 'application/vnd.google-apps.folder') pending.push(item.id);
          }
        }
      }
    }

    const candidates = await prisma.document.findMany({ where: { company } });
    const docs = candidates.filter(doc => doc.id === indexed?.id || driveIds.has(this.driveId(doc.googleDriveLink) || ''));
    if (indexed && !docs.some(doc => doc.id === indexed.id)) docs.push(indexed);
    if (targetDriveId) await this.driveService.deleteFile(targetDriveId);
    // Deleting the exact document rows cascades their reminders/notifications.
    if (docs.length > 0) await prisma.document.deleteMany({ where: { company, id: { in: docs.map(doc => doc.id) } } });
    this.companyCache.delete(company);
    await Promise.allSettled(docs.filter(doc => doc.geminiFileId)
      .map(doc => this.geminiService.deleteGeminiFile(doc.geminiFileId!)));

    return { success: true, message: 'Item permanently deleted' };
  }
}

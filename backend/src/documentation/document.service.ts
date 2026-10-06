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
import { createHash } from 'crypto';

const prisma = new PrismaClient();
type SearchFiles = { uri: string, mimeType: string, name: string, driveLink: string }[];
type GeneratedSearchAnswer = { text: string, cached: boolean,
  usage?: { promptTokenCount?: number, candidatesTokenCount?: number } };

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private companyCache: Map<string, { cacheName: string, expiresAt: number, model: string, sourceFingerprint: string }> = new Map();
  // Reuse is deliberately brief and bounded. Every caller still verifies Drive
  // membership, metadata and indexed sources before receiving an answer.
  private readonly searchAnswers = new Map<string, { company: string, expiresAt: number, answer: GeneratedSearchAnswer }>();
  private readonly searchFlights = new Map<string, Promise<GeneratedSearchAnswer>>();
  private readonly contextFlights = new Map<string, Promise<string | null>>();
  private readonly searchContexts = new Map<string, { company: string, cacheName: string, expiresAt: number }>();
  private readonly contextMisses = new Map<string, { company: string, expiresAt: number }>();
  private readonly searchReuseMs = 5 * 60 * 1000;
  private readonly maxSearchAnswers = 128;
  private readonly maxContextMisses = 64;
  private readonly maxSearchContexts = 64;

  constructor(
    private geminiService: GeminiService,
    private driveService: DriveService,
    private expiryExtractor: ExpiryExtractorService
  ) {}

  private requireCompany(company: string) {
    if (typeof company !== 'string' || !company.trim()) throw new BadRequestException('Company header missing');
    if (company.length > 200) throw new BadRequestException('Invalid company header');
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
    if (!['string', 'number'].includes(typeof id)) throw new BadRequestException('Invalid document ID');
    const textId = String(id);
    if (!/^[\w-]{1,200}$/.test(textId)) throw new BadRequestException('Invalid document ID');
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
      || doc.expiryStatus === 'REMINDER_DISABLED_REVIEW'
      || doc.expiryDetectionMethod !== 'MANUAL' && typeof doc.expiryConfidence === 'number' && doc.expiryConfidence < 0.85;
  }

  private isReminderSetupPending(doc: any) {
    return typeof doc.expiryStatus === 'string' && doc.expiryStatus.startsWith('AWAITING_REMINDER');
  }

  private isReminderDisabled(doc: any) {
    return doc.expiryStatus === 'REMINDER_DISABLED' || doc.expiryStatus === 'REMINDER_DISABLED_REVIEW';
  }

  private isReminderInactive(doc: any) {
    return this.isReminderSetupPending(doc) || this.isReminderDisabled(doc);
  }

  private reminderPayload(reminder: any = null) {
    return { reminder, reminderValue: reminder?.reminderValue ?? null,
      reminderUnit: reminder?.reminderUnit ?? null, reminderDays: reminder?.reminderDays ?? null };
  }

  private expiryPayload(doc: any) {
    const expiry = parseIsoDate(doc.expiryDate);
    return { ...doc, expiryStatus: expiryStatus(expiry, this.needsExpiryReview(doc)),
      reminderSetupPending: this.isReminderSetupPending(doc),
      reminderDisabled: this.isReminderDisabled(doc),
      ...(this.isReminderDisabled(doc) ? this.reminderPayload() : {}),
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
    if (this.isReminderDisabled(doc)) return 'Reminders are disabled for this document.';
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
      const reminder = this.isReminderInactive(doc) ? undefined : this.configuredReminder(doc.reminders) || doc.reminders[0];
      const payload = this.expiryPayload(doc);
      return { ...file, documentId: doc.id, documentType: doc.documentType, documentNumber: doc.documentNumber,
        expiryDate: doc.expiryDate, expiryStatus: payload.expiryStatus, expiryDateText: doc.expiryDateText,
        daysRemaining: payload.daysRemaining, reminderSetupPending: payload.reminderSetupPending,
        reminderDisabled: payload.reminderDisabled,
        expiryDetectionMethod: doc.expiryDetectionMethod, expiryConfidence: doc.expiryConfidence,
        ...this.reminderPayload(reminder ? this.serializeReminder(reminder) : null), reminderWarning: this.reminderWarning(doc) };
    }) };
  }

  private validFolderName(folderName: string) {
    if (typeof folderName !== 'string' || !folderName.trim() || folderName.length > 200 || /[\u0000-\u001f]/.test(folderName)) {
      throw new BadRequestException('A valid folder name is required');
    }
    return folderName.trim();
  }

  private async verifyCompanyFolder(company: string, folderId: string) {
    if (typeof folderId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(folderId)) throw new BadRequestException('Invalid folder ID');
    const directory = await this.driveService.getCompanyDirectory(company);
    if (folderId !== directory.companyFolderId && !directory.folders.some(folder => folder.id === folderId)) {
      throw new NotFoundException('Folder not found in this company');
    }
  }

  async createFolder(company: string, folderName: string, targetFolderId?: string) {
    this.requireCompany(company);
    const name = this.validFolderName(folderName);
    if (targetFolderId) await this.verifyCompanyFolder(company, targetFolderId);
    return this.driveService.createSubFolder(company, name, targetFolderId);
  }

  async renameFolder(id: string, company: string, newName: string) {
    this.requireCompany(company);
    const name = this.validFolderName(newName);
    const directory = await this.driveService.getCompanyDirectory(company);
    if (!directory.folders.some(folder => folder.id === id)) throw new NotFoundException('Folder not found in this company');
    return this.driveService.renameFolder(id, name);
  }

  async getDocumentContent(id: string | number, company: string, source?: string, range?: string, ifRange?: string) {
    this.requireCompany(company);
    if (source !== undefined && !['document', 'drive'].includes(source)) throw new BadRequestException('Invalid document source');
    let fileId: string;
    if (source === 'drive') {
      fileId = String(id);
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) throw new BadRequestException('Invalid document ID');
      const indexed = await prisma.document.findMany({ where: { company, googleDriveLink: { contains: fileId } },
        select: { googleDriveLink: true, status: true } });
      const exact = indexed.filter(doc => this.driveId(doc.googleDriveLink) === fileId);
      if (exact.length && !exact.some(doc => doc.status === 'ACTIVE')) throw new NotFoundException('Document not found in this company');
    } else {
      const doc = await this.findDocument(id, company);
      if (doc.status !== 'ACTIVE') throw new NotFoundException('Document not found in this company');
      const driveId = this.driveId(doc.googleDriveLink);
      if (!driveId) throw new NotFoundException('The original document is unavailable');
      fileId = driveId;
    }
    // Fresh ancestry metadata checks the exact file rather than walking every
    // company folder before each PDF range. A guessed or moved ID never grants
    // ownership, and no authorization result is retained between requests.
    return this.driveService.downloadCompanyFileStream(fileId, company, range, ifRange);
  }

  async processNewDocument(file: any, company: string, username: string, targetFolderId?: string, options: ReminderOptions = {}) {
    this.requireCompany(company);
    if (!Buffer.isBuffer(file?.buffer) || !file.buffer.length) throw new BadRequestException('An empty file cannot be uploaded');
    if (file.buffer.length > 50 * 1024 * 1024) throw new BadRequestException('Files must be 50 MiB or smaller');
    if (typeof file.originalname !== 'string' || !file.originalname.trim() || file.originalname.length > 255 ||
      /[\u0000-\u001f\u007f\\/]/.test(file.originalname)) throw new BadRequestException('Invalid filename');
    const choice = readReminderChoice(options);
    if (options.reminderSetup !== undefined && options.reminderSetup !== 'after-upload') throw new BadRequestException('Invalid reminder setup mode');
    const setupAfterUpload = options.reminderSetup === 'after-upload';
    if (targetFolderId) await this.verifyCompanyFolder(company, targetFolderId);
    const safeMimeType = this.geminiService.normalizeMimeType(file.mimetype, file.originalname);
    const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'olten-doc-'));
    const tempFilePath = path.join(tempDirectory, `upload${path.extname(file.originalname).slice(0, 20)}`);
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
        this.invalidateSearch(company);
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

  async clearReminder(documentId: string | number, company: string) {
    this.requireCompany(company);
    return prisma.$transaction(async client => {
      const doc = await this.findDocument(documentId, company, client);
      if (doc.status !== 'ACTIVE') throw new NotFoundException('Document not found in this company');
      let updated: any;
      try {
        // Lock the same row used by save, analysis and cron before deleting any
        // schedules. Their stale snapshots cannot recreate a cleared reminder.
        updated = await client.document.update({ where: {
          id: doc.id, company, status: doc.status, expiryDate: doc.expiryDate,
          expiryStatus: doc.expiryStatus, expiryDetectionMethod: doc.expiryDetectionMethod,
          expiryConfidence: doc.expiryConfidence,
        }, data: { expiryStatus: this.needsExpiryReview(doc) ? 'REMINDER_DISABLED_REVIEW' : 'REMINDER_DISABLED',
          lastExpiryCheck: new Date() } });
      } catch (error: any) {
        if (error.code === 'P2025') throw new BadRequestException('The document changed while clearing its reminder. Refresh and try again.');
        throw error;
      }
      await client.documentReminder.deleteMany({ where: { documentId: doc.id, company } });
      await client.expiryNotification.deleteMany({ where: { documentId: doc.id, company } });
      return { ...this.expiryPayload(updated), ...this.reminderPayload(), reminderWarning: this.reminderWarning(updated) };
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
    const reminder = await this.persistReminder(client, updated, choice, this.isReminderInactive(doc));
    return { updated, reminder };
  }

  private async extractStoredDocument(doc: any) {
    if (doc.status !== 'ACTIVE') throw new NotFoundException('Document not found in this company');
    const driveId = this.driveId(doc.googleDriveLink);
    if (!driveId) throw new BadRequestException('The original document is unavailable for analysis.');
    const directory = await this.driveService.getCompanyDirectory(doc.company);
    if (!directory.files.some(file => file.id === driveId)) {
      throw new NotFoundException('The original document is no longer available in this company.');
    }
    const buffer = await this.driveService.downloadFile(driveId);
    return this.geminiService.extractStructuredExpiry(buffer, doc.mimeType, doc.originalName || doc.filename);
  }

  private async applyAnalysis(doc: any, data: ExtractedExpiry | null) {
    return prisma.$transaction(async client => {
      // A date confirmed while Gemini was working must win. Ignore harmless cron
      // timestamps, but require the original expiry and trust values to match.
      const updated = await client.document.update({ where: { id: doc.id, company: doc.company,
        status: doc.status, expiryDate: doc.expiryDate, expiryDetectionMethod: doc.expiryDetectionMethod,
        expiryConfidence: doc.expiryConfidence,
        // Reminder save/disable can keep date and confidence unchanged. Their
        // explicit choice must still beat an analysis started before that choice.
        expiryStatus: doc.expiryStatus }, data: {
        expiryDate: data?.expiryDate || null, documentType: data?.documentType || null,
        documentNumber: data?.documentNumber || null, issueDate: data?.issueDate || null,
        renewalDate: data?.renewalDate || null, renewalDaysBeforeExpiry: data?.renewalDaysBeforeExpiry ?? null,
        expiryDateText: data?.expiryDateText || null, expiryConfidence: data?.confidence ?? null,
        expiryDetectionMethod: data?.method || 'GEMINI',
        expiryStatus: this.isReminderDisabled(doc)
          ? (!!data?.expiryDate && data.confidence < 0.85 ? 'REMINDER_DISABLED_REVIEW' : 'REMINDER_DISABLED')
          : this.isReminderSetupPending(doc)
          ? (!!data?.expiryDate && data.confidence < 0.85 ? 'AWAITING_REMINDER_REVIEW' : 'AWAITING_REMINDER')
          : expiryStatus(data?.expiryDate || null, !!data?.expiryDate && data.confidence < 0.85),
        lastExpiryCheck: new Date(),
      } });
      const reminders = await client.documentReminder.findMany({ where: { documentId: doc.id } });
      const previous = this.configuredReminder(reminders) || reminders[0];
      let reminder: any = null;
      if (!this.isReminderInactive(updated) && updated.expiryDate && !this.needsExpiryReview(updated)) {
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
    if (!Array.isArray(fileIds) || !fileIds.length || fileIds.length > 100 ||
      fileIds.some(id => !['string', 'number'].includes(typeof id) || !/^[\w-]{1,200}$/.test(String(id)))) {
      throw new BadRequestException('Provide between 1 and 100 valid document IDs');
    }
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
    if (!Array.isArray(reminders) || !reminders.length || reminders.length > 100) throw new BadRequestException('Provide between 1 and 100 reminders');
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
    const due = docs.flatMap(doc => {
      if (this.isReminderInactive(doc) || this.needsExpiryReview(doc) || !doc.expiryDate) return [];
      const configured = this.configuredReminder(doc.reminders);
      return doc.reminders.filter(rem => ['PENDING', 'PROCESSING'].includes(rem.status)
        && parseIsoDate(rem.expiryDate)?.getTime() === parseIsoDate(doc.expiryDate)?.getTime()
        && (!configured || !this.isAutomaticReminder(rem.reminderType)))
        .map(rem => ({ ...this.serializeReminder(rem, today), documentId: doc.id,
          driveFileId: this.driveId(doc.googleDriveLink), sourceUrl: doc.googleDriveLink,
          expiryDateText: doc.expiryDateText }))
        .filter(rem => rem.isTriggered);
    });
    // An empty bell cannot expose a stale source. Avoid walking every Drive
    // folder when reminders are disabled, handled, pending setup or not due.
    if (!due.length) return [];
    const directory = await this.driveService.getCompanyDirectory(company);
    const currentDriveIds = new Set(directory.files.map(file => file.id));
    return due.filter(rem => currentDriveIds.has(rem.driveFileId))
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }

  async updateNotificationStatus(reminderId: number, newStatus: string, company: string) {
    this.requireCompany(company);
    if (!Number.isSafeInteger(reminderId) || reminderId <= 0 || reminderId > 2147483647) throw new BadRequestException('Invalid reminder ID');
    if (!['PENDING', 'PROCESSING', 'FULFILLED'].includes(newStatus)) throw new BadRequestException('Invalid reminder status');
    const result = await prisma.documentReminder.updateMany({ where: { id: reminderId, company }, data: { status: newStatus } });
    if (!result.count) throw new NotFoundException('Reminder not found in this company');
    return { success: true };
  }

  private async currentSearchSources(company: string) {
    let directory: Awaited<ReturnType<DriveService['getCompanyDirectory']>>;
    try {
      directory = await this.driveService.getCompanyDirectory(company);
      if (!Array.isArray(directory?.files)) throw new Error('Incomplete directory');
    } catch {
      throw new BadRequestException('The current Google Drive directory could not be verified. Please retry your search.');
    }

    const currentFiles = directory.files.filter(file => typeof file.id === 'string' && file.id.length > 0);
    const byDriveId = new Map(currentFiles.map(file => [file.id, file]));
    // Drive membership is authoritative: retained index rows cannot make a
    // deleted, trashed or moved-out file searchable. Never match by filename.
    const docs = currentFiles.length ? await prisma.document.findMany({
      where: { company, status: 'ACTIVE' },
      select: { id: true, company: true, status: true, filename: true, mimeType: true,
        googleDriveLink: true, geminiFileUri: true },
    }) : [];
    const sourcesByDriveId = new Map<string, { documentId: number, driveId: string, uri: string,
      mimeType: string, name: string, driveLink: string }>();
    for (const doc of [...docs].sort((a, b) => b.id - a.id)) {
      const id = this.driveId(doc.googleDriveLink);
      const file = id ? byDriveId.get(id) : undefined;
      if (!file || !id || sourcesByDriveId.has(id) || doc.company !== company || doc.status !== 'ACTIVE'
        || typeof doc.geminiFileUri !== 'string' || !doc.geminiFileUri.trim()) continue;
      sourcesByDriveId.set(id, { documentId: doc.id, driveId: id, uri: doc.geminiFileUri,
        mimeType: doc.mimeType || file.mimeType || 'application/pdf',
        name: file.name || doc.filename || 'Unknown Document',
        driveLink: file.webViewLink || doc.googleDriveLink || `https://drive.google.com/file/d/${id}/view` });
    }
    const sources = [...sourcesByDriveId.values()].sort((a, b) => a.driveId.localeCompare(b.driveId));
    const inventory = currentFiles.map(file => ({ id: file.id, name: file.name || '',
      mimeType: file.mimeType || '', parents: [...(file.parents || [])].sort(),
      modifiedTime: file.modifiedTime || '', size: file.size || '', md5Checksum: file.md5Checksum || '',
      driveLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view` }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const sourceFingerprint = createHash('sha256').update(JSON.stringify({ inventory, sources })).digest('hex');
    return { currentFileCount: currentFiles.length, sourceFingerprint,
      inventory: inventory.map(file => ({ name: file.name || 'Unknown Document', driveLink: file.driveLink })),
      filesData: sources.map(({ uri, mimeType, name, driveLink }) => ({ uri, mimeType, name, driveLink })) };
  }

  private invalidateSearch(company: string) {
    this.companyCache.delete(company);
    for (const [key, value] of this.searchAnswers) if (value.company === company) this.searchAnswers.delete(key);
    for (const [key, value] of this.searchContexts) if (value.company === company) this.searchContexts.delete(key);
    for (const [key, value] of this.contextMisses) if (value.company === company) this.contextMisses.delete(key);
  }

  private pruneSearchReuse() {
    const now = Date.now();
    for (const [key, value] of this.searchAnswers) if (now >= value.expiresAt) this.searchAnswers.delete(key);
    for (const [key, value] of this.searchContexts) if (now >= value.expiresAt) this.searchContexts.delete(key);
    for (const [key, value] of this.contextMisses) if (now >= value.expiresAt) this.contextMisses.delete(key);
  }

  private isInventoryQuestion(query: string) {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?!\.]+$/, '').trim();
    // Match complete inventory questions only. A question about expiry, a
    // document's contents or a particular type of file must reach Gemini.
    return /^(?:(?:what|which) (?:docs?|documents?|files?) (?:do )?i have(?: available)?|do i have any (?:docs?|documents?|files?)(?: available)?|(?:what|which) (?:docs?|documents?|files?) are available|are there any (?:docs?|documents?|files?)(?: available)?|(?:list|show)(?: me)?(?: all| my| the)? (?:docs?|documents?|files?)(?: i have)?)(?: in (?:this|my|the) workspace)?$/.test(normalized);
  }

  private inventoryAnswer(files: { name: string, driveLink: string }[]) {
    const links = files.map(file => {
      const name = file.name.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]()<>#!|]/g, '\\$&');
      const link = file.driveLink.replace(/[()\s<>]/g, value => encodeURIComponent(value));
      return `- [${name}](${link})`;
    });
    return `You have ${files.length} ${files.length === 1 ? 'document' : 'documents'} in this workspace:\n\n${links.join('\n')}`;
  }

  private async contextForSearch(company: string, model: string, sourceFingerprint: string, filesData: SearchFiles) {
    const key = createHash('sha256').update(JSON.stringify([company, model, sourceFingerprint])).digest('hex');
    const previous = this.companyCache.get(company);
    if (previous && Date.now() < previous.expiresAt && previous.model === model
      && previous.sourceFingerprint === sourceFingerprint) return previous.cacheName;
    this.companyCache.delete(company);
    const warm = this.searchContexts.get(key);
    if (warm && Date.now() < warm.expiresAt) {
      this.companyCache.set(company, { cacheName: warm.cacheName, expiresAt: warm.expiresAt, model, sourceFingerprint });
      return warm.cacheName;
    }
    this.searchContexts.delete(key);
    const missed = this.contextMisses.get(key);
    if (missed && Date.now() < missed.expiresAt) return null;
    this.contextMisses.delete(key);
    const active = this.contextFlights.get(key);
    if (active) return active;
    const flight = (async () => {
      const cacheName = await this.geminiService.createDocumentCache(filesData, model).catch(() => null);
      if (cacheName) {
        const expiresAt = Date.now() + 55 * 60 * 1000;
        while (this.searchContexts.size >= this.maxSearchContexts) this.searchContexts.delete(this.searchContexts.keys().next().value!);
        this.searchContexts.set(key, { company, cacheName, expiresAt });
        this.companyCache.set(company, { cacheName, expiresAt, model, sourceFingerprint });
      } else {
        while (this.contextMisses.size >= this.maxContextMisses) this.contextMisses.delete(this.contextMisses.keys().next().value!);
        this.contextMisses.set(key, { company, expiresAt: Date.now() + this.searchReuseMs });
      }
      return cacheName;
    })();
    // At very high concurrency, continue without retaining another promise.
    if (this.contextFlights.size < this.maxContextMisses) this.contextFlights.set(key, flight);
    try { return await flight; }
    finally { if (this.contextFlights.get(key) === flight) this.contextFlights.delete(key); }
  }

  private async recordSearch(query: string, company: string, username: string, model: string,
    answer: GeneratedSearchAnswer, reused = false) {
    try {
      await (prisma as any).searchHistory.create({ data: {
        username: username || 'Anonymous', company, query, response: answer.text, modelUsed: model,
        promptTokens: reused ? 0 : answer.usage?.promptTokenCount || 0,
        completionTokens: reused ? 0 : answer.usage?.candidatesTokenCount || 0,
      } });
    } catch {}
  }

  async searchDocuments(query: string, company: string, username: string, requestedModel?: string) {
    this.requireCompany(company);
    const targetModel = requestedModel || process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    let ownFlight: Promise<GeneratedSearchAnswer> | undefined;
    let answerKey = '';
    try {
      this.pruneSearchReuse();
      const { currentFileCount, sourceFingerprint, filesData, inventory } = await this.currentSearchSources(company);
      if (!currentFileCount) {
        this.invalidateSearch(company);
        return { answer: 'No documents are currently available in this workspace. Upload a document to search it.',
          model: targetModel, sourcesSearched: 0, cached: false };
      }
      const inventoryQuestion = this.isInventoryQuestion(query);
      if (!inventoryQuestion && !filesData.length) throw new BadRequestException('Documents exist, but have not finished indexing in Gemini.');
      answerKey = createHash('sha256').update(JSON.stringify([company, targetModel, sourceFingerprint,
        companyToday().toISOString().slice(0, 10), query.trim()])).digest('hex');
      const savedAnswer = this.searchAnswers.get(answerKey);
      const reusedAnswer = savedAnswer && Date.now() < savedAnswer.expiresAt ? savedAnswer : undefined;
      let reused = !!reusedAnswer;
      let answer: GeneratedSearchAnswer;
      if (inventoryQuestion) {
        answer = { text: this.inventoryAnswer(inventory), cached: false };
      } else if (reusedAnswer) {
        answer = reusedAnswer.answer;
      } else {
        const active = this.searchFlights.get(answerKey);
        reused = !!active;
        if (active) answer = await active;
        else {
          ownFlight = (async () => {
            const cacheName = await this.contextForSearch(company, targetModel, sourceFingerprint, filesData);
            const generated = await this.geminiService.askQuestion(query, filesData, cacheName, targetModel);
            return { text: generated.text || 'No response generated.', usage: generated.usage, cached: !!cacheName };
          })();
          if (this.searchFlights.size < this.maxSearchAnswers) this.searchFlights.set(answerKey, ownFlight);
          answer = await ownFlight;
        }
      }
      // A deletion can happen while Gemini is responding, including in another
      // app instance or directly in Drive. Do not return or retain that answer.
      const currentSources = await this.currentSearchSources(company);
      if (currentSources.sourceFingerprint !== sourceFingerprint) {
        this.invalidateSearch(company);
        return { answer: 'The workspace documents changed while this search was running. Please search again to use the current files.',
          model: targetModel, sourcesSearched: 0, cached: false, sourcesChanged: true };
      }
      if (!inventoryQuestion && !reused && answer.text.length <= 64 * 1024) {
        while (this.searchAnswers.size >= this.maxSearchAnswers) this.searchAnswers.delete(this.searchAnswers.keys().next().value!);
        this.searchAnswers.set(answerKey, { company, expiresAt: Date.now() + this.searchReuseMs, answer });
      }
      await this.recordSearch(query, company, username, targetModel, answer, reused);
      return { answer: answer.text, model: targetModel,
        sourcesSearched: inventoryQuestion ? currentFileCount : filesData.length, cached: reused || answer.cached };
    } catch (error: any) {
      this.invalidateSearch(company);
      throw new BadRequestException(error.message);
    } finally { if (ownFlight && this.searchFlights.get(answerKey) === ownFlight) this.searchFlights.delete(answerKey); }
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
      const directory = await this.driveService.getCompanyDirectory(company);
      if (!directory.files.some(file => file.id === targetDriveId)) {
        throw new NotFoundException('The original document is no longer available in this company. Its saved record was preserved.');
      }
      driveIds.add(targetDriveId);
    } else if (indexed) {
      throw new NotFoundException('The original document is unavailable. Its saved record was preserved.');
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
    this.invalidateSearch(company);
    await Promise.allSettled(docs.filter(doc => doc.geminiFileId)
      .map(doc => this.geminiService.deleteGeminiFile(doc.geminiFileId!)));

    return { success: true, message: 'Item permanently deleted' };
  }
}

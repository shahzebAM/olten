import { Injectable, BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException, HttpException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
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
  private readonly companyWrites = new Map<string, Set<Promise<unknown>>>();
  private readonly companyDeletions = new Map<string, Promise<unknown>>();
  private readonly deletedCompanies = new Map<string, string>();

  constructor(
    private geminiService: GeminiService,
    private driveService: DriveService,
    private expiryExtractor: ExpiryExtractorService
  ) {}

  private requireCompany(company: string) {
    if (typeof company !== 'string' || !company.trim()) throw new BadRequestException('Company header missing');
    if (company.length > 200) throw new BadRequestException('Invalid company header');
  }

  async getImportLinks(company: string) {
    this.requireCompany(company);
    const docs = await prisma.document.findMany({
      where: { company, status: 'ACTIVE' },
      select: {
        id: true,
        originalName: true,
        documentType: true,
        expiryDate: true,
        expiryStatus: true,
        googleDriveLink: true,
        importFileId: true,
        shipmentId: true,
        productId: true,
        regulatoryStatus: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map((doc) => ({
      ...doc,
      regulatoryStatus:
        doc.expiryDate && doc.expiryDate < companyToday()
          ? 'EXPIRED'
          : doc.regulatoryStatus,
    }));
  }

  async updateImportLinks(
    id: string,
    company: string,
    body: {
      importFileId?: string | null;
      shipmentId?: string | null;
      productId?: number | null;
      regulatoryStatus?: string;
      documentType?: string;
    },
  ) {
    this.requireCompany(company);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !/^\d+$/.test(id) ||
      !Number.isSafeInteger(Number(id)) ||
      Number(id) < 1 ||
      Number(id) > 2147483647
    ) {
      throw new BadRequestException(
        'A valid document and import link payload are required.',
      );
    }
    for (const field of ['importFileId', 'shipmentId'] as const) {
      if (
        body[field] !== undefined &&
        body[field] !== null &&
        (typeof body[field] !== 'string' ||
          !body[field].trim() ||
          body[field].length > 100)
      ) {
        throw new BadRequestException(`Invalid ${field}.`);
      }
    }
    if (
      body.productId !== undefined &&
      body.productId !== null &&
      (!Number.isSafeInteger(body.productId) ||
        body.productId <= 0 ||
        body.productId > 2147483647)
    )
      throw new BadRequestException('Invalid product.');
    if (
      body.regulatoryStatus !== undefined &&
      ![
        'NOT_REQUESTED',
        'REQUESTED',
        'RECEIVED',
        'UNDER_REVIEW',
        'ACCEPTED',
        'REJECTED',
        'EXPIRED',
      ].includes(body.regulatoryStatus)
    ) {
      throw new BadRequestException('Invalid regulatory document status.');
    }
    if (
      body.documentType !== undefined &&
      (typeof body.documentType !== 'string' || body.documentType.length > 150)
    ) {
      throw new BadRequestException(
        'Document type must be at most 150 characters.',
      );
    }
    return this.withCompanyWrite(company, () =>
      prisma.$transaction(async (tx) => {
        const doc = await tx.document.findFirst({
          where: { id: Number(id), company, status: 'ACTIVE' },
        });
        if (!doc)
          throw new NotFoundException('Document not found in this workspace.');
        let importFileId =
          body.importFileId === undefined
            ? doc.importFileId
            : body.importFileId;
        const shipmentId =
          body.shipmentId === undefined ? doc.shipmentId : body.shipmentId;
        const productId =
          body.productId === undefined ? doc.productId : body.productId;
        if (shipmentId) {
          const shipment = await tx.shipment.findFirst({
            where: { id: shipmentId, company },
          });
          if (!shipment)
            throw new BadRequestException(
              'Shipment not found in this workspace.',
            );
          if (
            body.importFileId !== undefined &&
            importFileId !== shipment.importFileId
          ) {
            throw new BadRequestException(
              'Shipment must belong to the selected import file.',
            );
          }
          importFileId = shipment.importFileId;
        }
        if (
          importFileId &&
          !(await tx.importFile.findFirst({
            where: { id: importFileId, company },
          }))
        ) {
          throw new BadRequestException(
            'Import file not found in this workspace.',
          );
        }
        if (
          productId &&
          !(await tx.product.findFirst({ where: { id: productId, company } }))
        ) {
          throw new BadRequestException('Product not found in this workspace.');
        }
        const regulatoryStatus = body.regulatoryStatus ?? doc.regulatoryStatus;
        if (
          regulatoryStatus === 'ACCEPTED' &&
          doc.expiryDate &&
          doc.expiryDate < companyToday()
        ) {
          throw new BadRequestException(
            'An expired document cannot be accepted.',
          );
        }
        return tx.document.update({
          where: { id: doc.id, company },
          data: {
            importFileId,
            shipmentId,
            productId,
            regulatoryStatus,
            ...(body.documentType !== undefined
              ? { documentType: body.documentType.trim() || null }
              : {}),
          },
        });
      }),
    );
  }

  private async withCompanyWrite<T>(company: string, action: () => Promise<T>): Promise<T> {
    this.requireCompany(company);
    if (this.companyDeletions.has(company)) throw new ConflictException('This workspace is being deleted. Please wait.');
    const deletedId = this.deletedCompanies.get(company);
    if (deletedId) {
      if (!await this.isRecreatedCompany(company, deletedId)) throw new NotFoundException('This workspace was deleted.');
      if (this.companyDeletions.has(company)) throw new ConflictException('This workspace is being deleted. Please wait.');
      const latest = this.deletedCompanies.get(company);
      if (latest && latest !== deletedId) throw new ConflictException('The workspace changed. Refresh and retry.');
      if (this.deletedCompanies.get(company) === deletedId) this.deletedCompanies.delete(company);
    }
    let writes = this.companyWrites.get(company);
    if (!writes) { writes = new Set(); this.companyWrites.set(company, writes); }
    const operation = action();
    writes.add(operation);
    try { return await operation; }
    finally {
      writes.delete(operation);
      if (!writes.size && this.companyWrites.get(company) === writes) this.companyWrites.delete(company);
    }
  }

  private async isRecreatedCompany(company: string, deletedId: string) {
    const current = await prisma.company.findUnique({ where: { name: company }, select: { id: true } });
    return !!current && current.id !== deletedId;
  }

  async deleteCompanyWorkspace(company: string) {
    this.requireCompany(company);
    const current = this.companyDeletions.get(company);
    if (current) return current;
    const operation = this.removeCompanyWorkspace(company);
    this.companyDeletions.set(company, operation);
    try { return await operation; }
    finally { if (this.companyDeletions.get(company) === operation) this.companyDeletions.delete(company); }
  }

  private async assertNoFinanceHistory(
    company: string,
    client: Prisma.TransactionClient = prisma,
  ) {
    const where = { where: { company } };
    const history = await Promise.all([
      client.erpAuditLog.count(where),
      client.landedCost.count(where),
      client.productCostHistory.count(where),
      client.financeDocument.count(where),
      client.financePayment.count(where),
      client.paymentRequest.count(where),
      client.ledgerAccount.count(where),
      client.accountingJournal.count(where),
      client.accountingMapping.count(where),
      client.bankReconciliation.count(where),
      client.deviceAsset.count(where),
      client.serviceVisit.count(where),
    ]);
    if (history.some((count) => count > 0))
      throw new ConflictException(
        'A workspace with Phase 3 financial, service or audit history cannot be deleted.',
      );
  }

  private async removeCompanyWorkspace(company: string) {
    const workspace = await prisma.company.findUnique({ where: { name: company } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    // Finish existing uploads/replacements before deleting their parent folder.
    // New writes are blocked, so no source or index row can be saved afterward.
    await Promise.allSettled([...(this.companyWrites.get(company) || [])]);
    const currentWorkspace = await prisma.company.findUnique({ where: { name: company }, select: { id: true } });
    if (!currentWorkspace || currentWorkspace.id !== workspace.id) throw new ConflictException('The workspace changed. Refresh and retry deletion.');
    await this.assertNoFinanceHistory(company);
    let geminiFileIds: string[] = [];
    const deleted = await this.driveService.deleteCompanyFolder(
      company,
      () =>
        prisma
          .$transaction(
            async (client) => {
              const current = await client.company.findUnique({
                where: { name: company },
              });
              if (!current || current.id !== workspace.id)
                throw new ConflictException(
                  'The workspace changed. Refresh and retry deletion.',
                );
              await this.assertNoFinanceHistory(company, client);
              const docs = await client.document.findMany({
                where: { company },
                select: { geminiFileId: true },
              });
              geminiFileIds = [
                ...new Set(
                  docs.flatMap((doc) =>
                    doc.geminiFileId ? [doc.geminiFileId] : [],
                  ),
                ),
              ];
              // Document cascades remove its expiry reminders and notifications.
              await client.document.deleteMany({ where: { company } });
              await client.searchHistory.deleteMany({ where: { company } });
              return client.company.delete({
                where: { id: workspace.id, name: company },
              });
            },
            { isolationLevel: 'Serializable' },
          )
          .catch((error: unknown) => {
            if (error instanceof HttpException) throw error;
            const code =
              error && typeof error === 'object' && 'code' in error
                ? error.code
                : undefined;
            if (code === 'P2025')
              throw new ConflictException(
                'The workspace changed. Refresh and retry deletion.',
              );
            if (code === 'P2034')
              throw new ConflictException(
                'The workspace changed during processing. Its database history was preserved. Refresh and retry.',
              );
            throw new ServiceUnavailableException(
              'The Drive folder was removed, but database cleanup failed. Please retry workspace deletion.',
            );
          }),
      () => this.isRecreatedCompany(company, workspace.id),
    );
    this.deletedCompanies.set(company, workspace.id);
    this.invalidateSearch(company);
    // Remote AI index cleanup never delays the completed Drive/DB deletion and
    // generates no AI tokens. Failed cleanup cannot make old rows searchable.
    void Promise.allSettled(geminiFileIds.map(id => this.geminiService.deleteGeminiFile(id)))
      .then(results => {
        if (results.some(result => result.status === 'rejected')) this.logger.warn('Some deleted workspace Gemini indexes could not be removed.');
      });
    return deleted;
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
        importFileId: doc.importFileId, shipmentId: doc.shipmentId, productId: doc.productId,
        regulatoryStatus: doc.expiryDate && doc.expiryDate < companyToday() ? 'EXPIRED' : doc.regulatoryStatus,
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
    return this.withCompanyWrite(company, () => this.createCompanyFolder(company, folderName, targetFolderId));
  }

  private async createCompanyFolder(company: string, folderName: string, targetFolderId?: string) {
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

  private validateUpload(file: any) {
    if (!Buffer.isBuffer(file?.buffer) || !file.buffer.length) throw new BadRequestException('An empty file cannot be uploaded');
    if (file.buffer.length > 50 * 1024 * 1024) throw new BadRequestException('Files must be 50 MiB or smaller');
    if (typeof file.originalname !== 'string' || !file.originalname.trim() || file.originalname.length > 255 ||
      /[\u0000-\u001f\u007f\\/]/.test(file.originalname)) throw new BadRequestException('Invalid filename');
    return this.geminiService.normalizeMimeType(file.mimetype, file.originalname);
  }

  private sourceFingerprint(metadata: any) {
    return JSON.stringify([metadata.name, metadata.mimeType, metadata.size,
      [...(metadata.parents || [])].sort(), metadata.modifiedTime, metadata.md5Checksum, metadata.version]);
  }

  private replacementState(doc: any) {
    // Cron advances updatedAt/lastExpiryCheck and normalizes the display status.
    // Those bookkeeping writes must not cancel a long upload. Source evidence
    // and explicit disabled/pending choices still have to match the start.
    return JSON.stringify([doc.status, doc.googleDriveLink, doc.filename, doc.originalName,
      doc.mimeType, doc.sizeBytes, doc.geminiFileUri, doc.geminiFileId, doc.documentType,
      doc.documentNumber, doc.issueDate, doc.expiryDate, doc.renewalDate, doc.renewalDaysBeforeExpiry,
      doc.expiryDateText, doc.expiryConfidence, doc.expiryDetectionMethod,
      this.isReminderDisabled(doc), this.isReminderSetupPending(doc), this.needsExpiryReview(doc)]);
  }

  async replaceDocument(documentId: string | number, file: any, company: string, username: string, expectedDriveFileId?: string) {
    return this.withCompanyWrite(company, () => this.replaceCompanyDocument(documentId, file, company, username, expectedDriveFileId));
  }

  private async replaceCompanyDocument(documentId: string | number, file: any, company: string, username: string, expectedDriveFileId?: string) {
    this.requireCompany(company);
    const safeMimeType = this.validateUpload(file);
    const original = await this.findDocument(documentId, company);
    if (original.status !== 'ACTIVE') throw new NotFoundException('Document not found in this company');
    const oldDriveId = this.driveId(original.googleDriveLink);
    if (!oldDriveId) throw new NotFoundException('The original document is unavailable.');
    if (expectedDriveFileId !== undefined && (typeof expectedDriveFileId !== 'string'
      || !/^[A-Za-z0-9_-]{1,200}$/.test(expectedDriveFileId))) throw new BadRequestException('Invalid original source ID');
    if (expectedDriveFileId !== undefined && expectedDriveFileId !== oldDriveId) {
      throw new ConflictException('The document changed. Refresh it before replacing its source.');
    }
    const originalMetadata = await this.driveService.getCompanyFileMetadata(oldDriveId, company);
    const parentId = originalMetadata.parents?.[0];
    if (!parentId || !Array.isArray(originalMetadata.parents) || originalMetadata.parents.length !== 1) {
      throw new NotFoundException('The original document folder is unavailable.');
    }
    const fingerprint = this.sourceFingerprint(originalMetadata);
    const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'olten-replace-'));
    const tempFilePath = path.join(tempDirectory, `upload${path.extname(file.originalname).slice(0, 20)}`);
    let driveLink: string | undefined;
    let geminiData: { fileUri?: string; fileId?: string; mimeType?: string } = {};
    let committed = false;
    try {
      await fs.promises.writeFile(tempFilePath, file.buffer);
      const indexedFile = this.geminiService.uploadFileToGemini(tempFilePath, safeMimeType, file.originalname);
      const [driveResult, indexResult, analysisResult] = await Promise.allSettled([
        this.driveService.uploadFileToDrive(file.buffer, safeMimeType, file.originalname, company, parentId),
        indexedFile,
        this.geminiService.extractStructuredExpiry(file.buffer, safeMimeType, file.originalname, indexedFile),
      ]);
      if (driveResult.status === 'fulfilled') driveLink = driveResult.value;
      if (indexResult.status === 'fulfilled') geminiData = indexResult.value;
      if (driveResult.status === 'rejected') throw new BadRequestException('The replacement could not be uploaded. Your original document was preserved.');
      if (indexResult.status === 'rejected' || !geminiData.fileId || !geminiData.fileUri) {
        throw new BadRequestException('The replacement could not be indexed for search. Your original document was preserved. Please retry.');
      }
      const analysis = analysisResult.status === 'fulfilled' ? analysisResult.value : null;
      const expiry = parseIsoDate(analysis?.expiryDate);
      if (!analysis || !expiry || !Number.isFinite(analysis.confidence) || analysis.confidence < 0.85 || analysis.confidence > 1) {
        throw new BadRequestException('A reliable expiry date could not be detected in the replacement. Your original document and reminder were preserved. Upload a clearer document.');
      }
      const newDriveId = this.driveId(driveLink);
      if (!newDriveId || newDriveId === oldDriveId) throw new BadRequestException('The replacement source could not be verified. Your original document was preserved.');
      // Both sources must still be in this company and the original folder.
      // A folder moved outside the workspace during analysis must not be used.
      const [currentOriginal, replacementMetadata] = await Promise.all([
        this.driveService.getCompanyFileMetadata(oldDriveId, company),
        this.driveService.getCompanyFileMetadata(newDriveId, company),
      ]);
      if (this.sourceFingerprint(currentOriginal) !== fingerprint || replacementMetadata.parents?.length !== 1
        || replacementMetadata.parents[0] !== parentId || replacementMetadata.mimeType !== safeMimeType
        || replacementMetadata.size !== undefined && Number(replacementMetadata.size) !== file.buffer.length
        || replacementMetadata.md5Checksum && replacementMetadata.md5Checksum !== createHash('md5').update(file.buffer).digest('hex')) {
        throw new ConflictException('The source or its folder changed while the replacement was analyzed. Your original document was preserved. Refresh and retry.');
      }
      const result = await prisma.$transaction(async client => {
        const current = await client.document.findFirst({ where: { id: original.id, company } });
        if (!current || this.replacementState(current) !== this.replacementState(original)) {
          throw new ConflictException('The document or reminder changed while the replacement was analyzed. Your current settings were preserved. Refresh and retry.');
        }
        const updated = await client.document.update({ where: { id: original.id, company, status: 'ACTIVE',
          googleDriveLink: current.googleDriveLink, updatedAt: current.updatedAt }, data: {
          filename: file.originalname, originalName: file.originalname, mimeType: geminiData.mimeType || safeMimeType,
          sizeBytes: file.buffer.length, uploadedBy: username || 'Anonymous', googleDriveLink: driveLink,
          geminiFileUri: geminiData.fileUri, geminiFileId: geminiData.fileId,
          documentType: analysis.documentType || null, documentNumber: analysis.documentNumber || null,
          issueDate: analysis.issueDate || null, expiryDate: expiry,
          renewalDate: analysis.renewalDate || null, renewalDaysBeforeExpiry: analysis.renewalDaysBeforeExpiry ?? null,
          expiryDateText: analysis.expiryDateText || null, expiryConfidence: analysis.confidence,
          expiryDetectionMethod: analysis.method,
          expiryStatus: this.isReminderDisabled(current) ? 'REMINDER_DISABLED'
            : this.isReminderSetupPending(current) ? 'AWAITING_REMINDER' : expiryStatus(expiry),
          lastExpiryCheck: new Date(),
        } });
        const reminders = await client.documentReminder.findMany({ where: { documentId: original.id } });
        const previous = this.configuredReminder(reminders) || reminders[0];
        // Clear the old expiry's legacy notifications in the same transaction.
        await client.expiryNotification.deleteMany({ where: { documentId: original.id, company } });
        let reminder: any = null;
        if (!this.isReminderInactive(updated) && previous) {
          reminder = await this.persistReminder(client, updated, choiceFromReminder(previous), true);
        } else {
          await client.documentReminder.deleteMany({ where: { documentId: original.id, company } });
          if (!this.isReminderInactive(updated)) {
            // A missing schedule does not authorize creating a default alert.
            const pending = await client.document.update({ where: { id: original.id, company },
              data: { expiryStatus: 'AWAITING_REMINDER' } });
            Object.assign(updated, pending);
          }
        }
        return { ...this.expiryPayload(updated), ...this.reminderPayload(reminder), driveFileId: newDriveId,
          sourceUrl: driveLink, modifiedTime: replacementMetadata.modifiedTime,
          md5Checksum: replacementMetadata.md5Checksum, reminderWarning: this.reminderWarning(updated) };
      }, { timeout: 15000 });
      committed = true;
      this.invalidateSearch(company);
      const cleanupWarnings: string[] = [];
      // Cleanup is after commit. Never delete a source edited or moved externally
      // since staging, and never tell the user the replacement failed after save.
      try {
        const current = await this.driveService.getCompanyFileMetadata(oldDriveId, company);
        if (this.sourceFingerprint(current) !== fingerprint) throw new Error('Original source changed');
        await this.driveService.deleteFile(oldDriveId);
      } catch {
        cleanupWarnings.push('The new document was saved, but the previous Drive copy was retained because it changed or could not be removed.');
      }
      if (original.geminiFileId && original.geminiFileId !== geminiData.fileId) {
        await this.geminiService.deleteGeminiFile(original.geminiFileId).catch(() => {
          cleanupWarnings.push('The new document was saved, but its previous Gemini index could not be removed.');
        });
      }
      if (cleanupWarnings.length) this.logger.warn(`Replacement cleanup incomplete for document ${original.id}`);
      return { ...result, ...(cleanupWarnings.length ? { cleanupWarning: cleanupWarnings.join(' ') } : {}) };
    } catch (error: any) {
      if (!committed) {
        const stagedId = this.driveId(driveLink);
        await Promise.allSettled([
          ...(stagedId && stagedId !== oldDriveId ? [this.driveService.deleteFile(stagedId)] : []),
          ...(geminiData.fileId && geminiData.fileId !== original.geminiFileId
            ? [this.geminiService.deleteGeminiFile(geminiData.fileId)] : []),
        ]);
      }
      if (error.code === 'P2025') throw new ConflictException('The document or reminder changed while the replacement was analyzed. Your current settings were preserved. Refresh and retry.');
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException) throw error;
      throw new BadRequestException('The replacement could not be saved. Your original document and reminder were preserved. Please retry.');
    } finally {
      await fs.promises.unlink(tempFilePath).catch(() => undefined);
      await fs.promises.rmdir(tempDirectory).catch(() => undefined);
    }
  }

  async processNewDocument(file: any, company: string, username: string, targetFolderId?: string, options: ReminderOptions = {}) {
    return this.withCompanyWrite(company, () => this.processNewCompanyDocument(file, company, username, targetFolderId, options));
  }

  private async processNewCompanyDocument(file: any, company: string, username: string, targetFolderId?: string, options: ReminderOptions = {}) {
    this.requireCompany(company);
    const safeMimeType = this.validateUpload(file);
    const choice = readReminderChoice(options);
    if (options.reminderSetup !== undefined && options.reminderSetup !== 'after-upload') throw new BadRequestException('Invalid reminder setup mode');
    const setupAfterUpload = options.reminderSetup === 'after-upload';
    if (targetFolderId) await this.verifyCompanyFolder(company, targetFolderId);
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
        status: doc.status, googleDriveLink: doc.googleDriveLink,
        expiryDate: doc.expiryDate, expiryDetectionMethod: doc.expiryDetectionMethod,
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

  async updateNotificationStatus(reminderId: number, newStatus: string, company: string,
    options: { expectedExpiryDate?: string; expectedDriveFileId?: string } = {}) {
    this.requireCompany(company);
    if (!Number.isSafeInteger(reminderId) || reminderId <= 0 || reminderId > 2147483647) throw new BadRequestException('Invalid reminder ID');
    if (!['PENDING', 'PROCESSING', 'FULFILLED'].includes(newStatus)) throw new BadRequestException('Invalid reminder status');
    const expectedExpiry = options.expectedExpiryDate === undefined ? undefined : parseIsoDate(options.expectedExpiryDate);
    if (options.expectedExpiryDate !== undefined && (typeof options.expectedExpiryDate !== 'string' || !expectedExpiry)) {
      throw new BadRequestException('Invalid expected reminder expiry');
    }
    const sourceId = options.expectedDriveFileId;
    if (sourceId !== undefined && (typeof sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(sourceId))) {
      throw new BadRequestException('Invalid expected document source');
    }
    const sourceDocs = sourceId === undefined ? undefined : (await prisma.document.findMany({
      where: { company, status: 'ACTIVE', googleDriveLink: { contains: sourceId } },
      select: { id: true, googleDriveLink: true },
    })).filter(doc => this.driveId(doc.googleDriveLink) === sourceId);
    if (sourceDocs && !sourceDocs.length) throw new ConflictException('This reminder belongs to an older document. Refresh the reminders and try again.');
    const result = await prisma.documentReminder.updateMany({ where: { id: reminderId, company,
      ...(expectedExpiry ? { expiryDate: expectedExpiry } : {}),
      ...(sourceDocs ? { document: { company, status: 'ACTIVE',
        OR: sourceDocs.map(doc => ({ id: doc.id, googleDriveLink: doc.googleDriveLink })) } } : {}),
    }, data: { status: newStatus } });
    if (!result.count) {
      if (expectedExpiry || sourceId !== undefined) throw new ConflictException('This reminder belongs to an older document. Refresh the reminders and try again.');
      throw new NotFoundException('Reminder not found in this company');
    }
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

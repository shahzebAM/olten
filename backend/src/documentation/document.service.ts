import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { GeminiService } from './gemini.service';
import { DriveService } from './drive.service';
import { ExpiryExtractorService, ExtractedExpiry } from './expiry-extractor.service';
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

  async getCompanyDirectory(company: string) {
    return this.driveService.getCompanyDirectory(company);
  }

  async createFolder(company: string, folderName: string) {
    return this.driveService.createSubFolder(company, folderName);
  }

  async processNewDocument(file: any, company: string, username: string, targetFolderId?: string) {
    const tempFilePath = path.join(os.tmpdir(), `${Date.now()}-${file.originalname}`);
    fs.writeFileSync(tempFilePath, file.buffer);

    let safeMimeType = file.mimetype;
    if (file.originalname.toLowerCase().endsWith('.pdf')) safeMimeType = 'application/pdf';

    let driveLink, geminiData: any = {};
    let finalExpiryData: ExtractedExpiry | null = null;
    let fallbackDateString = '';

    try {
      // 1. Waterfall Extraction
      const rawText = file.buffer.toString('utf-8'); 
      finalExpiryData = this.expiryExtractor.extractViaRegex(rawText);

      if (!finalExpiryData || finalExpiryData.confidence < 0.85) {
        const aiResult = await this.geminiService.extractStructuredExpiry(file.buffer, safeMimeType, file.originalname);
        if (aiResult) finalExpiryData = aiResult;
      }

      // 2. Parallel Uploads & Legacy Extraction logic for compatibility
      const [driveRes, geminiRes, legacyExpiry] = await Promise.all([
        this.driveService.uploadFileToDrive(file.buffer, safeMimeType, file.originalname, company, targetFolderId),
        this.geminiService.uploadFileToGemini(tempFilePath, safeMimeType, file.originalname),
        this.geminiService.extractExpiryFromBuffer(file.buffer, safeMimeType, file.originalname)
      ]);
      
      driveLink = driveRes;
      geminiData = geminiRes;
      fallbackDateString = legacyExpiry;
    } catch (error: any) {
      throw new BadRequestException(`Upload failed: ${error.message}`);
    } finally {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); 
    }

    let calculatedStatus = 'NO_EXPIRY';
    if (finalExpiryData?.expiryDate) {
      calculatedStatus = finalExpiryData.confidence >= 0.85 ? 'ACTIVE' : 'NEEDS_REVIEW';
    }

    const doc = await (prisma as any).document.create({
      data: {
        filename: file.originalname,
        originalName: file.originalname,
        mimeType: safeMimeType,
        sizeBytes: file.size,
        company: company,
        geminiFileUri: geminiData.fileUri,
        geminiFileId: geminiData.fileId,
        googleDriveLink: driveLink,
        status: 'ACTIVE',
        uploadedBy: username,
        // New Expiry Data
        documentType: finalExpiryData?.documentType,
        documentNumber: finalExpiryData?.documentNumber,
        issueDate: finalExpiryData?.issueDate,
        expiryDate: finalExpiryData?.expiryDate,
        renewalDate: finalExpiryData?.renewalDate,
        renewalDaysBeforeExpiry: finalExpiryData?.renewalDaysBeforeExpiry,
        expiryDateText: finalExpiryData?.expiryDateText,
        expiryConfidence: finalExpiryData?.confidence,
        expiryDetectionMethod: finalExpiryData?.method,
        expiryStatus: calculatedStatus,
      },
    });

    this.companyCache.delete(company);
    
    // Return document merged with the fallback date string for older frontend compat
    return { ...doc, expiryDate: fallbackDateString || finalExpiryData?.expiryDate?.toISOString() };
  }

  // Phase 8: Manual Expiry Override
  async updateManualExpiry(documentId: number, company: string, newDate: string) {
    const parsedDate = new Date(newDate);
    if (isNaN(parsedDate.getTime())) throw new BadRequestException('Invalid date format');

    return (prisma as any).document.update({
      where: { id: documentId },
      data: {
        expiryDate: parsedDate,
        expiryDetectionMethod: 'MANUAL',
        expiryStatus: 'ACTIVE',
        expiryConfidence: 1.0,
        lastExpiryCheck: new Date()
      }
    });
  }

  // Phase 8: Re-Analyze Request
  async reanalyzeDocument(documentId: number, company: string) {
    const doc = await (prisma as any).document.findUnique({ where: { id: documentId } });
    if (!doc || doc.company !== company) throw new BadRequestException('Document not found');
    if (!doc.geminiFileUri) throw new BadRequestException('Document not uploaded to Gemini');

    // For re-analysis without the buffer, we utilize the background file URI method
    const aiResult = await this.geminiService.extractExpiryDate(doc.geminiFileUri, doc.mimeType);
    
    if (aiResult) {
       return (prisma as any).document.update({
          where: { id: doc.id },
          data: {
             expiryDate: new Date(aiResult),
             expiryDetectionMethod: 'GEMINI',
             expiryStatus: 'NEEDS_REVIEW',
             expiryConfidence: 0.8
          }
       });
    }
    return doc;
  }

  // Preserved existing manual batch analyzer
  async analyzeExpiryDates(fileIds: any[], company: string) {
    const results: Record<string, string> = {};
    const numericIds = fileIds.map((id: any) => Number(id)).filter((id: any) => !isNaN(id));

    const docs = await (prisma as any).document.findMany({
      where: { id: { in: numericIds.length > 0 ? numericIds : [-1] }, company: company }
    });

    await Promise.all(docs.map(async (doc: any) => {
      if (doc.geminiFileUri && doc.geminiFileId) {
        try {
          let status = await this.geminiService.checkFileStatus(doc.geminiFileId);
          let retries = 0;
          while (status === 'PROCESSING' && retries < 15) {
             await new Promise(resolve => setTimeout(resolve, 3000));
             status = await this.geminiService.checkFileStatus(doc.geminiFileId);
             retries++;
          }
          if (status === 'ACTIVE') {
            const expiry = await this.geminiService.extractExpiryDate(doc.geminiFileUri, doc.mimeType);
            if (expiry) results[doc.id.toString()] = expiry;
          }
        } catch (e) {}
      }
    }));
    return results;
  }

  // Preserved manual reminder saving from Modal UI
  async saveReminders(reminders: any[], company: string) {
    const savedReminders: any[] = []; 
    
    for (const rem of reminders) {
      const docId = Number(rem.id); 
      if (isNaN(docId) || !rem.expiryDate) continue;

      const triggerDate = new Date(rem.expiryDate);
      triggerDate.setDate(triggerDate.getDate() - (Number(rem.reminderDays) || 30));

      const saved = await (prisma as any).documentReminder.upsert({
        where: { documentId_reminderType: { documentId: docId, reminderType: 'MANUAL' } },
        update: {
          expiryDate: new Date(rem.expiryDate),
          reminderDays: Number(rem.reminderDays) || 30,
          triggerDate: triggerDate
        },
        create: {
          company: company,
          documentId: docId,
          fileName: rem.name,
          reminderType: 'MANUAL',
          expiryDate: new Date(rem.expiryDate), 
          reminderDays: Number(rem.reminderDays) || 30,
          triggerDate: triggerDate,
          status: 'PENDING'
        }
      });
      savedReminders.push(saved); 
    }
    return { success: true, count: savedReminders.length };
  }

  async getActiveNotifications(company: string) {
    const today = new Date();
    
    const reminders = await (prisma as any).documentReminder.findMany({
      where: { 
        company: company,
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      orderBy: { expiryDate: 'asc' }
    });

    return reminders.map((rem: any) => {
       const isTriggered = rem.triggerDate ? today >= rem.triggerDate : false;
       return { ...rem, isTriggered };
    });
  }

  async updateNotificationStatus(reminderId: number, newStatus: string) {
    return await (prisma as any).documentReminder.update({
      where: { id: Number(reminderId) },
      data: { status: newStatus }
    });
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

      const targetModel = requestedModel || 'gemini-1.5-flash';
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

  async deleteDocument(driveId: string) {
    try {
      await this.driveService.deleteFile(driveId);
    } catch (e) {}

    const docs = await (prisma as any).document.findMany({
      where: { googleDriveLink: { contains: driveId } }
    });

    if (docs && docs.length > 0) {
      const doc = docs[0];
      if (doc.geminiFileId) {
        try { await this.geminiService.deleteGeminiFile(doc.geminiFileId); } catch (e) {}
      }
      await (prisma as any).document.delete({ where: { id: doc.id } });
    }
    
    return { success: true, message: 'Item permanently deleted' };
  }
}
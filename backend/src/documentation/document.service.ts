import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { GeminiService } from './gemini.service';
import { DriveService } from './drive.service';
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

    // CRITICAL FIX: Ensure PDFs are identified correctly so Gemini is never blind!
    let safeMimeType = file.mimetype;
    if (file.originalname.toLowerCase().endsWith('.pdf')) {
        safeMimeType = 'application/pdf';
    }

    let driveLink;
    let geminiData;

    try {
      // Upload to Drive and Gemini instantly without waiting for AI analysis
      const [driveResponse, geminiResponse] = await Promise.all([
        this.driveService.uploadFileToDrive(file.buffer, safeMimeType, file.originalname, company, targetFolderId),
        this.geminiService.uploadFileToGemini(tempFilePath, safeMimeType, file.originalname)
      ]);
      
      driveLink = driveResponse;
      geminiData = geminiResponse;
    } catch (error: any) {
      this.logger.error(`Upload Process Failed: ${error.message}`);
      throw new BadRequestException(`Upload failed: ${error.message}`);
    } finally {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); 
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
      },
    });

    this.companyCache.delete(company);
    
    // Return instantly. AI analysis will happen in the background!
    return doc;
  }

async analyzeExpiryDates(fileIds: any[], company: string) {
    const results: Record<string, string> = {};
    const numericIds = fileIds.map(id => Number(id)).filter(id => !isNaN(id));

    const docs = await (prisma as any).document.findMany({
      where: { 
        id: { in: numericIds.length > 0 ? numericIds : [-1] },
        company: company
      }
    });

    // Process ALL documents simultaneously for maximum speed
    await Promise.all(docs.map(async (doc) => {
      if (doc.geminiFileUri && doc.geminiFileId) {
        try {
          let status = await this.geminiService.checkFileStatus(doc.geminiFileId);
          let retries = 0;
          
          while (status === 'PROCESSING' && retries < 15) {
             await new Promise(resolve => setTimeout(resolve, 1500));
             status = await this.geminiService.checkFileStatus(doc.geminiFileId);
             retries++;
          }
          
          if (status === 'ACTIVE') {
            const expiry = await this.geminiService.extractExpiryDate(doc.geminiFileUri, doc.mimeType);
            if (expiry) {
              results[doc.id.toString()] = expiry;
            }
          }
        } catch (e) {
          this.logger.warn(`Gemini check failed for ${doc.geminiFileId}`);
        }
      }
    }));

    return results;
  }

  async saveReminders(reminders: any[], company: string) {
    const savedReminders: any[] = []; 
    
    for (const rem of reminders) {
      const docId = Number(rem.id); 
      
      if (isNaN(docId) || !rem.expiryDate) continue;

      const saved = await (prisma as any).documentReminder.create({
        data: {
          company: company,
          documentId: docId,
          fileName: rem.name,
          expiryDate: new Date(rem.expiryDate), 
          reminderDays: Number(rem.reminderDays) || 30
        }
      });
      savedReminders.push(saved); 
    }
    
    return { success: true, count: savedReminders.length };
  }

  async searchDocuments(query: string, company: string, username: string, requestedModel?: string) {
    try {
      const docs = await (prisma as any).document.findMany({
        where: { company, status: 'ACTIVE' },
      });

      if (!docs || docs.length === 0) {
        throw new Error(`No active documents found for ${company}.`);
      }

      const filesData = docs
        .filter((d: any) => typeof d.geminiFileUri === 'string' && d.geminiFileUri.length > 0)
        .map((d: any) => ({
          uri: d.geminiFileUri,
          mimeType: d.mimeType || 'application/pdf',
          name: d.filename || 'Unknown Document',
          driveLink: d.googleDriveLink || 'No link available',
        }));

      if (filesData.length === 0) {
        throw new Error('Documents exist, but have not finished indexing in Gemini.');
      }

      const targetModel = requestedModel || 'gemini-1.5-flash';
      let cacheName: string | null = null;
      let cacheInfo = this.companyCache.get(company);

      if (!cacheInfo || Date.now() > cacheInfo.expiresAt || cacheInfo.model !== targetModel) {
        this.logger.log(`Generating Context Cache for ${company} using ${targetModel}...`);
        
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
      } catch (dbError) {
        this.logger.warn('SearchHistory table not found in Prisma Schema. Skipping database logging.');
      }

      return { answer: responseText, model: targetModel, sourcesSearched: filesData.length, cached: !!cacheName };
    
    } catch (error: any) {
      this.logger.error(`Search Request Failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }

  async deleteDocument(driveId: string) {
    try {
      await this.driveService.deleteFile(driveId);
    } catch (e) { 
      this.logger.warn(`Drive file inaccessible or already deleted.`); 
    }

    const docs = await (prisma as any).document.findMany({
      where: { googleDriveLink: { contains: driveId } }
    });

    if (docs && docs.length > 0) {
      const doc = docs[0];

      if (doc.geminiFileId) {
        try { 
          await this.geminiService.deleteGeminiFile(doc.geminiFileId); 
        } catch (e) { 
          this.logger.warn(`Gemini file inaccessible`); 
        }
      }

      await (prisma as any).document.delete({ where: { id: doc.id } });
    }
    
    return { success: true, message: 'Item permanently deleted from Drive, Gemini, and Database' };
  }
}
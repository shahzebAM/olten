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

    let driveLink;
    let geminiData;

    try {
      const [driveResponse, geminiResponse] = await Promise.all([
        this.driveService.uploadFileToDrive(file.buffer, file.mimetype, file.originalname, company, targetFolderId),
        this.geminiService.uploadFileToGemini(tempFilePath, file.mimetype, file.originalname)
      ]);
      
      driveLink = driveResponse;
      geminiData = geminiResponse;
    } catch (error: any) {
      this.logger.error(`Upload Process Failed: ${error.message}`);
      throw new BadRequestException(`Upload failed: ${error.message}`);
    } finally {
      if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); 
    }

    // @ts-ignore
    const doc = await prisma.document.create({
      data: {
        filename: file.originalname,
        originalName: file.originalname,
        mimeType: file.mimetype,
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
    return doc;
  }

  async searchDocuments(query: string, company: string, username: string, requestedModel?: string) {
    try {
      // @ts-ignore
      const docs = await prisma.document.findMany({
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
        // @ts-ignore
        await prisma.searchHistory.create({
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
    // 1. Delete from Google Drive FIRST (Handles both folders and files)
    try {
      await this.driveService.deleteFile(driveId);
    } catch (e) { 
      this.logger.warn(`Drive file inaccessible or already deleted.`); 
    }

    // 2. Look up the document in the Prisma DB using the Drive ID
    // @ts-ignore
    const docs = await prisma.document.findMany({
      where: { 
        googleDriveLink: { contains: driveId } 
      }
    });

    // 3. If it's a file that exists in the database, wipe it from Gemini and Prisma
    if (docs && docs.length > 0) {
      const doc = docs[0];

      if (doc.geminiFileId) {
        try { 
          await this.geminiService.deleteGeminiFile(doc.geminiFileId); 
        } catch (e) { 
          this.logger.warn(`Gemini file inaccessible`); 
        }
      }

      // @ts-ignore
      await prisma.document.delete({ where: { id: doc.id } });
    }
    
    return { success: true, message: 'Item permanently deleted from Drive, Gemini, and Database' };
  }
}
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
  
  // UPDATED: Now tracks which model generated the cache
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
    // @ts-ignore
    const docs = await prisma.document.findMany({
      where: { company, status: 'ACTIVE' },
    });

    if (!docs || docs.length === 0) throw new BadRequestException(`No active documents found.`);

    const filesData: { uri: string; mimeType: string; name: string; driveLink: string }[] = docs
      .filter((d: any) => typeof d.geminiFileUri === 'string' && d.geminiFileUri.length > 0)
      .map((d: any) => ({
        uri: d.geminiFileUri,
        mimeType: d.mimeType || 'application/pdf',
        name: d.filename || 'Unknown Document',
        driveLink: d.googleDriveLink || 'No link available',
      }));

    if (filesData.length === 0) throw new BadRequestException('Documents exist, but have not finished indexing.');

    const targetModel = requestedModel || 'gemini-3.8-flash';
    let cacheName: string | null = null;
    let cacheInfo = this.companyCache.get(company);

    // If cache does not exist, expired, OR the model changed, create a fresh one
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

    return { answer: responseText, model: targetModel, sourcesSearched: filesData.length, cached: !!cacheName };
  }
}
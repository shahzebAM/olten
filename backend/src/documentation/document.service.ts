import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { GeminiService } from './gemini.service';
import { DriveService } from './drive.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const prisma = new PrismaClient();

@Injectable()
export class DocumentService {
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
    // 1. Upload directly to Drive from RAM
    const driveLink = await this.driveService.uploadFileToDrive(
      file.buffer, 
      file.mimetype, 
      file.originalname, 
      company, 
      targetFolderId
    );

    // 2. Safely upload to Gemini
    const tempFilePath = path.join(os.tmpdir(), `${Date.now()}-${file.originalname}`);
    fs.writeFileSync(tempFilePath, file.buffer);

    let geminiData;
    try {
      geminiData = await this.geminiService.uploadFileToGemini(
        tempFilePath,
        file.mimetype,
        file.originalname
      );
    } finally {
      // Deletes the temporary file instantly
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }

    // 3. Save Record to Database
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

    return doc;
  }

  async routeQuery(query: string): Promise<'gemini-1.5-flash' | 'gemini-1.5-pro'> {
    const classificationPrompt = `
      Classify the complexity of this user query into "EASY" or "HARD".
      EASY: Extracting basic facts, names, dates, simple lookups, or single document summaries.
      HARD: Comparing multiple documents, deep financial analysis, finding contradictions, logical multi-step reasoning.
      Query: "${query}"
      Reply ONLY with "EASY" or "HARD".
    `;

    const response = await this.geminiService.askQuestion(classificationPrompt, [], 'gemini-1.5-flash');
    const text = response.text || '';
    return text.trim().toUpperCase().includes('HARD') ? 'gemini-1.5-pro' : 'gemini-1.5-flash';
  }

  async searchDocuments(query: string, company: string, username: string) {
    // @ts-ignore
    const docs = await prisma.document.findMany({
      where: { company, status: 'ACTIVE' },
    });

    if (!docs || docs.length === 0) {
      throw new BadRequestException(`No active documents found for ${company}. Please upload documents first.`);
    }

    // Prepare both the URI and MIME type for Gemini RAG
    const filesData: { uri: string; mimeType: string }[] = docs
      .filter((d: any) => typeof d.geminiFileUri === 'string' && d.geminiFileUri.length > 0)
      .map((d: any) => ({
        uri: d.geminiFileUri,
        mimeType: d.mimeType || 'application/pdf',
      }));

    if (filesData.length === 0) {
      throw new BadRequestException('Documents exist, but have not finished indexing in Gemini.');
    }

    const targetModel = await this.routeQuery(query);
    const answer = await this.geminiService.askQuestion(query, filesData, targetModel);
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

    return {
      answer: responseText,
      model: targetModel,
      sourcesSearched: filesData.length,
    };
  }
}
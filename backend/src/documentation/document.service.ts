import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { GeminiService } from './gemini.service';

const prisma = new PrismaClient();

@Injectable()
export class DocumentService {
  constructor(private geminiService: GeminiService) {}

  async processNewDocument(file: any, company: string, username: string) {
    // 1. Upload to Gemini File Storage
    const geminiData = await this.geminiService.uploadFileToGemini(
      file.path, 
      file.mimetype, 
      file.originalname
    );

    // 2. Save to PostgreSQL strictly partitioned by company
    // @ts-ignore
    const doc = await prisma.document.create({
      data: {
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        company: company,
        geminiFileUri: geminiData.fileUri,
        geminiFileId: geminiData.fileId,
        status: 'ACTIVE',
        uploadedBy: username
      }
    });

    return doc;
  }

  // --- AUTOMATIC MODEL ROUTER ---
  async routeQuery(query: string): Promise<'gemini-3.6-flash' | 'gemini-3.6-pro'> {
    const classificationPrompt = `
      Classify the complexity of this user query into "EASY" or "HARD".
      EASY: Extracting basic facts, names, dates, simple lookups, or single document summaries.
      HARD: Comparing multiple documents, deep financial analysis, finding contradictions, logical multi-step reasoning.
      Query: "${query}"
      Reply ONLY with "EASY" or "HARD".
    `;
    
    // UPDATED: Use the newer 3.6 flash model for fast and low-cost classification
    const response = await this.geminiService.askQuestion(classificationPrompt, [], 'gemini-3.6-flash');
    const text = response.text || '';
    
    // UPDATED: Route to 3.6-pro or 3.6-flash based on complexity
    return text.trim().toUpperCase().includes('HARD') ? 'gemini-3.6-pro' : 'gemini-3.6-flash';
  }

  async searchDocuments(query: string, company: string, username: string) {
    // 1. Fetch only active documents for the active corporate tenant
    // @ts-ignore
    const docs = await prisma.document.findMany({
      where: { company, status: 'ACTIVE' }
    });

    if (!docs || docs.length === 0) {
      throw new BadRequestException(`No active documents found for ${company}. Please upload documents first.`);
    }

    // 2. Filter out null or undefined URIs safely
    const fileUris: string[] = docs
      .map((d: any) => d.geminiFileUri)
      .filter((uri: any): uri is string => typeof uri === 'string' && uri.length > 0);

    if (fileUris.length === 0) {
      throw new BadRequestException("Documents exist, but have not finished indexing in Gemini.");
    }

    // 3. Dynamic Model Routing
    const targetModel = await this.routeQuery(query);

    // 4. Query Execution
    const answer = await this.geminiService.askQuestion(query, fileUris, targetModel);
    const responseText = answer.text || 'No response generated.';

    // 5. Audit Logging to PostgreSQL
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
      }
    });

    return { 
      answer: responseText, 
      model: targetModel, 
      sourcesSearched: fileUris.length 
    };
  }
}
import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI, Type } from '@google/genai';
import * as dotenv from 'dotenv';
import { ExtractedExpiry } from './expiry-extractor.service';

dotenv.config();

@Injectable()
export class GeminiService {
  private ai: GoogleGenAI;
  private readonly logger = new Logger(GeminiService.name);

  private readonly systemInstruction = `You are an elite corporate ERP AI Document Search Assistant.
CRITICAL RULES:
1. Base your answer STRICTLY and EXCLUSIVELY on the provided documents. Do NOT invent or guess information.
2. If the user asks for a document, a file, or a link, you MUST provide the exact Google Drive link from the Reference Directory.
3. Format links cleanly in Markdown: [Document Name](URL).
4. Always cite your source document at the end of your answer.`;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); 
  }

  async uploadFileToGemini(filePath: string, mimeType: string, displayName: string) {
    try {
      const uploadResult = await this.ai.files.upload({
        file: filePath,
        config: { mimeType, displayName },
      });
      return { fileUri: uploadResult.uri, fileId: uploadResult.name };
    } catch (error: any) { 
      this.logger.error(`Gemini Upload Failed: ${error.message}`);
      throw error;
    }
  }

  async checkFileStatus(fileId: string): Promise<string> {
    const file = await this.ai.files.get({ name: fileId });
    return file.state as string; 
  }

  async deleteGeminiFile(fileId: string) {
    await this.ai.files.delete({ name: fileId });
  }

  async createDocumentCache(filesData: { uri: string, mimeType: string, name: string, driveLink: string }[], modelName: string = 'gemini-3.6-flash'): Promise<string | null> {
    try {
      const directoryText = "Reference Directory:\n" + filesData.map(f => `- ${f.name}: ${f.driveLink}`).join('\n');
      const cache = await this.ai.caches.create({
        model: modelName,
        config: {
          systemInstruction: this.systemInstruction,
          contents: [
            {
              role: 'user',
              parts: [
                { text: directoryText },
                ...filesData.map(file => ({
                  fileData: { fileUri: file.uri, mimeType: file.mimeType }
                }))
              ]
            }
          ],
          ttl: '3600s', 
        }
      });
      return cache.name || null;
    } catch (error: any) {
      this.logger.warn(`Context Cache skipped: ${error.message}`);
      return null;
    }
  }

  async askQuestion(query: string, filesData: { uri: string, mimeType: string, name: string, driveLink: string }[], cacheName?: string | null, modelName: string = 'gemini-3.6-flash') {
    let config: any = { temperature: 0.0 }; 
    let parts: any[] = [];
    
    if (cacheName) {
      config.cachedContent = cacheName;
      parts = [{ text: query }];
    } else {
      config.systemInstruction = this.systemInstruction;
      const directoryText = "Reference Directory:\n" + filesData.map(f => `- ${f.name}: ${f.driveLink}`).join('\n');
      parts = [
        { text: directoryText },
        ...filesData.map(file => ({ fileData: { fileUri: file.uri, mimeType: file.mimeType } })),
        { text: query }
      ];
    }

    const response = await this.ai.models.generateContent({
      model: modelName, 
      contents: [{ role: 'user', parts: parts }],
      config: config
    });

    return { text: response.text, usage: response.usageMetadata };
  }

  // Phase 3: Structured JSON Fallback Extraction
  async extractStructuredExpiry(buffer: Buffer, mimeType: string, filename: string): Promise<ExtractedExpiry | null> {
    try {
      const base64Data = buffer.toString('base64');
      const safeMimeType = filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : mimeType;

      const prompt = `Analyze this document. Extract the expiry date, issue date, document type, document number, and any explicitly stated renewal notice periods.
CRITICAL RULES:
- Never invent dates. If there is no expiry date, return null.
- Never assume the latest date is the expiry date. Distinguish between Issue Date, Birth Date, and Expiry Date.
- Preserve the exact source text in expiryDateText.
- Use ISO dates (YYYY-MM-DD).`;

      const response = await this.ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { data: base64Data, mimeType: safeMimeType } },
            { text: prompt }
          ]
        }],
        config: {
          temperature: 0.0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              documentType: { type: Type.STRING },
              documentNumber: { type: Type.STRING },
              issueDate: { type: Type.STRING, nullable: true },
              expiryDate: { type: Type.STRING, nullable: true },
              renewalDate: { type: Type.STRING, nullable: true },
              renewalDaysBeforeExpiry: { type: Type.INTEGER, nullable: true },
              expiryDateText: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              reason: { type: Type.STRING }
            }
          }
        }
      });

      const textResult = response.text?.trim();
      if (!textResult) return null;

      const parsed = JSON.parse(textResult);
      
      // Prevent returning empty object states as valid expirations
      if (!parsed.expiryDate) return null;

      return {
        documentType: parsed.documentType || null,
        documentNumber: parsed.documentNumber || null,
        issueDate: parsed.issueDate ? new Date(parsed.issueDate) : null,
        expiryDate: parsed.expiryDate ? new Date(parsed.expiryDate) : null,
        renewalDate: parsed.renewalDate ? new Date(parsed.renewalDate) : null,
        renewalDaysBeforeExpiry: parsed.renewalDaysBeforeExpiry || null,
        expiryDateText: parsed.expiryDateText || '',
        confidence: parsed.confidence || 0,
        reason: parsed.reason || '',
        method: 'GEMINI'
      };
    } catch (error: any) {
      this.logger.warn(`Structured Expiry Extraction Failed: ${error.message}`);
      return null;
    }
  }

  // Preserved old fast buffer extraction to avoid breaking legacy code paths if any
  async extractExpiryFromBuffer(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
    try {
      const base64Data = buffer.toString('base64');
      const safeMimeType = filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : mimeType;
      const prompt = `Analyze this document. Find the expiration date, validity end date, or renewal deadline. Return ONLY the date.`;

      const response = await this.ai.models.generateContent({
        model: 'gemini-1.5-flash', 
        contents: [{
          role: 'user',
          parts: [{ inlineData: { data: base64Data, mimeType: safeMimeType } }, { text: prompt }]
        }],
        config: { temperature: 0.0 }
      });

      const text = response.text?.trim() || '';
      const parsedDate = new Date(text);
      if (!isNaN(parsedDate.getTime())) return parsedDate.toISOString().split('T')[0]; 
      
      const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
      return dateMatch ? dateMatch[0] : '';
    } catch (error: any) {
      return '';
    }
  }

  // Preserved old background URI extraction
  async extractExpiryDate(fileUri: string, mimeType: string): Promise<string> {
    try {
      const prompt = `Analyze this document. Find the expiration date, validity end date, or renewal deadline. You must reply ONLY with the exact date in strict YYYY-MM-DD format (e.g., 2026-10-06). If no date is found, reply exactly with "NULL". Do not include any other text, sentences, or punctuation.`;
      const response = await this.ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: [{ role: 'user', parts: [{ fileData: { fileUri, mimeType } }, { text: prompt }] }],
        config: { temperature: 0.0 } 
      });
      const text = response.text?.trim() || 'NULL';
      if (text === 'NULL' || text === '') return '';
      return text; 
    } catch (error) {
      return ''; 
    }
  }
}
import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class GeminiService {
  private ai: GoogleGenAI;
  private readonly logger = new Logger(GeminiService.name);

  // STRICT ERP INSTRUCTIONS
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
        ...filesData.map(file => ({
          fileData: { fileUri: file.uri, mimeType: file.mimeType }
        })),
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

  // --- NEW FAST INSTANT BUFFER EXTRACTION ---
// --- NEW FAST INSTANT BUFFER EXTRACTION ---
// --- NEW FAST INSTANT BUFFER EXTRACTION ---
  async extractExpiryFromBuffer(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
    try {
      const base64Data = buffer.toString('base64');
      
      let safeMimeType = mimeType;
      if (filename.toLowerCase().endsWith('.pdf')) safeMimeType = 'application/pdf';

      const prompt = `Analyze this document. Find the expiration date, validity end date, or renewal deadline. Return ONLY the date.`;

      const response = await this.ai.models.generateContent({
        model: 'gemini-1.5-flash', 
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { data: base64Data, mimeType: safeMimeType } },
            { text: prompt }
          ]
        }],
        config: { temperature: 0.0 }
      });

      const text = response.text?.trim() || '';
      
      // 1. Let Javascript powerfully parse natural text like "January 28, 2028" into YYYY-MM-DD
      const parsedDate = new Date(text);
      if (!isNaN(parsedDate.getTime())) {
          return parsedDate.toISOString().split('T')[0]; 
      }
      
      // 2. Fallback if it's hidden in weird text
      const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
      return dateMatch ? dateMatch[0] : '';
    } catch (error: any) {
      this.logger.warn(`Inline Expiry Extraction Failed: ${error.message}`);
      return '';
    }
  }

  // --- OLD SLOW EXTRACTION (Kept as fallback) ---
async extractExpiryDate(fileUri: string, mimeType: string): Promise<string> {
    try {
      const prompt = `Analyze this document. Find the expiration date, validity end date, or renewal deadline. Return ONLY the exact date in YYYY-MM-DD format (e.g. 2026-10-06). Do not write sentences.`;
      
      const response = await this.ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: [{ role: 'user', parts: [{ fileData: { fileUri, mimeType } }, { text: prompt }] }],
        config: { temperature: 0.0 } 
      });
      
      const text = response.text?.trim() || '';
      
      // Guarantee perfect date format extraction
      const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
      if (dateMatch) return dateMatch[0];
      
      const parsedDate = new Date(text);
      if (!isNaN(parsedDate.getTime())) return parsedDate.toISOString().split('T')[0]; 
      
      return ''; 
    } catch (error: any) {
      return ''; 
    }
  }
}
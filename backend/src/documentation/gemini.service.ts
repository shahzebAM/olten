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
}
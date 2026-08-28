import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class GeminiService {
  private ai: GoogleGenAI;
  private readonly logger = new Logger(GeminiService.name);

  constructor() {
    this.ai = new GoogleGenAI(); 
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

  // UPDATED: Now accepts name and driveLink
  async createDocumentCache(filesData: { uri: string, mimeType: string, name: string, driveLink: string }[]): Promise<string | null> {
    try {
      // Create a text directory for Gemini to reference
      const directoryText = "Reference Directory:\n" + filesData.map(f => `- ${f.name}: ${f.driveLink}`).join('\n');

      const cache = await this.ai.caches.create({
        model: 'gemini-3.6-flash',
        config: {
          systemInstruction: "You are an ERP assistant. Base answers ONLY on provided documents. If the user asks for a document link or file, provide the exact Google Drive link from the Reference Directory. Always cite the exact source document name and page number if available in format [Source: filename, Page: X].",
          contents: [
            {
              role: 'user',
              parts: [
                { text: directoryText }, // Inject the links first
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
      this.logger.warn(`Context Cache skipped (likely below token minimum): ${error.message}`);
      return null;
    }
  }

  // UPDATED: Now accepts name and driveLink for the fallback path
  async askQuestion(query: string, filesData: { uri: string, mimeType: string, name: string, driveLink: string }[], cacheName?: string | null) {
    let config: any = { temperature: 0.1 };
    let parts: any[] = [];
    
    if (cacheName) {
      config.cachedContent = cacheName;
      parts = [{ text: query }];
    } else {
      config.systemInstruction = "You are an ERP assistant. Base answers ONLY on provided documents. If the user asks for a document link or file, provide the exact Google Drive link from the Reference Directory. Always cite the exact source document name and page number if available in format [Source: filename, Page: X].";
      
      const directoryText = "Reference Directory:\n" + filesData.map(f => `- ${f.name}: ${f.driveLink}`).join('\n');
      
      parts = [
        { text: directoryText }, // Inject the links
        ...filesData.map(file => ({
          fileData: { fileUri: file.uri, mimeType: file.mimeType }
        })),
        { text: query } // Append the user query at the end
      ];
    }

    const response = await this.ai.models.generateContent({
      model: 'gemini-3.6-flash', 
      contents: [{ role: 'user', parts: parts }],
      config: config
    });

    return { text: response.text, usage: response.usageMetadata };
  }
}
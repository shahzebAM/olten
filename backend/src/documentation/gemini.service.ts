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

  // --- NEW EXPIRY DATE EXTRACTION ---
// --- NEW EXPIRY DATE EXTRACTION ---
// --- NEW EXPIRY DATE EXTRACTION ---
// --- NEW EXPIRY DATE EXTRACTION ---
// --- NEW EXPIRY DATE EXTRACTION ---
  async extractExpiryDate(fileUri: string, mimeType: string): Promise<string | null> {
    try {
      // Ultimate foolproof prompt. Tells it exactly what to look for and forces a clean MM,DD,YYYY output.
      const prompt = `Analyze this document and find the final expiration date, validity end date, or renewal deadline. 
      Look for phrases like "Validity of License", "Valid Until", "Expiry Date", or similar.
      
      No matter how the date is written (e.g., "28 January 2028", "05/16/2028", "January 28, 2028"), you MUST translate it into EXACTLY this format: MM,DD,YYYY (for example, 01,28,2028).
      
      CRITICAL RULES:
      1. Return ONLY the formatted date string (MM,DD,YYYY).
      2. Do NOT include any other text, spaces, or words.
      3. If no date is found, return exactly the word: null`;
      
      const response = await this.ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: [{
          role: 'user',
          parts: [
            { fileData: { fileUri, mimeType } },
            { text: prompt }
          ]
        }],
        config: { temperature: 0.0 } 
      });
      
      const text = response.text?.trim() || 'null';
      
      // Safety catch: If AI returns null or blank, return empty string for frontend
      if (text.toLowerCase().includes('null') || text === '') {
          return ''; 
      }
      
      // Clean the string just in case the AI added a period or space at the end
      const cleanDate = text.replace(/[^0-9,]/g, '');
      
      return cleanDate; 
    } catch (error: any) {
      this.logger.warn(`Expiry Extraction Failed: ${error.message}`);
      return ''; 
    }
  }
}
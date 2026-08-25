import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class GeminiService {
  private ai: GoogleGenAI;
  private readonly logger = new Logger(GeminiService.name);

  constructor() {
    // Automatically picks up process.env.GEMINI_API_KEY
    this.ai = new GoogleGenAI(); 
  }

  // 1. Upload Document to Gemini File Storage
  async uploadFileToGemini(filePath: string, mimeType: string, displayName: string) {
    try {
      const uploadResult = await this.ai.files.upload({
        file: filePath,
        // FIXED: mimeType and displayName must be wrapped inside config
        config: {
          mimeType: mimeType,
          displayName: displayName,
        },
      });
      return {
        fileUri: uploadResult.uri,
        fileId: uploadResult.name,
      };
    } catch (error: any) { // FIXED: Added 'any' so TypeScript allows .message
      this.logger.error(`Gemini Upload Failed: ${error.message}`);
      throw error;
    }
  }

  // 2. Check Indexing Status (PDFs need time to process)
  async checkFileStatus(fileId: string): Promise<string> {
    const file = await this.ai.files.get({ name: fileId });
    return file.state as string; // returns 'PROCESSING', 'ACTIVE', or 'FAILED'
  }

  // 3. Delete File from Gemini
  async deleteGeminiFile(fileId: string) {
    await this.ai.files.delete({ name: fileId });
  }

  // 4. The RAG Query Engine
  async askQuestion(query: string, fileUris: string[], model: string) {
    // Create the content payload mapping the retrieved URIs
    const contents = [
      ...fileUris.map(uri => ({
        role: 'user',
        parts: [{ fileData: { fileUri: uri } }]
      })),
      { role: 'user', parts: [{ text: query }] }
    ];

    const response = await this.ai.models.generateContent({
      model: model,
      contents: contents,
      config: {
        systemInstruction: "You are an ERP assistant. Base your answers ONLY on the provided documents. If the answer is not in the documents, say so. Always cite the exact source document name and page number if available in format [Source: filename, Page: X].",
        temperature: 0.1, // Keep it factual
      }
    });

    return {
      text: response.text,
      usage: response.usageMetadata
    };
  }
}
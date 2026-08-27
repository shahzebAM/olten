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
        config: {
          mimeType: mimeType,
          displayName: displayName,
        },
      });
      return {
        fileUri: uploadResult.uri,
        fileId: uploadResult.name,
      };
    } catch (error: any) { 
      this.logger.error(`Gemini Upload Failed: ${error.message}`);
      throw error;
    }
  }

  // 2. Check Indexing Status
  async checkFileStatus(fileId: string): Promise<string> {
    const file = await this.ai.files.get({ name: fileId });
    return file.state as string; 
  }

  // 3. Delete File from Gemini
  async deleteGeminiFile(fileId: string) {
    await this.ai.files.delete({ name: fileId });
  }

  // 4. The RAG Query Engine (UPDATED)
  // Changed the signature to accept both URI and MIME Type
  async askQuestion(query: string, filesData: { uri: string, mimeType: string }[], model: string) {
    
    // Combine all files and the text prompt into a SINGLE array of 'parts'
    const parts: any[] = filesData.map(file => ({
      fileData: { 
        fileUri: file.uri, 
        mimeType: file.mimeType 
      }
    }));

    // Add the user's typed question to the very end of the files
    parts.push({ text: query });

    const response = await this.ai.models.generateContent({
      model: model,
      contents: [
        { 
          role: 'user', 
          parts: parts // Everything is sent inside one single user message!
        }
      ],
      config: {
        systemInstruction: "You are an ERP assistant. Base your answers ONLY on the provided documents. If the answer is not in the documents, say so. Always cite the exact source document name and page number if available in format [Source: filename, Page: X].",
        temperature: 0.1, 
      }
    });

    return {
      text: response.text,
      usage: response.usageMetadata
    };
  }
}
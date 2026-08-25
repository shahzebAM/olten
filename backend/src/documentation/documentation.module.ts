import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { GeminiService } from './gemini.service';
import { DriveService } from './drive.service'; // <-- 1. Import it here

@Module({
controllers: [DocumentController],
  // Make sure there is only ONE 'providers' array here!
  providers: [DocumentService, GeminiService, DriveService],
})
export class DocumentationModule {}
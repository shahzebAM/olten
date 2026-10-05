import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { GeminiService } from './gemini.service';
import { DriveService } from './drive.service';
import { ExpiryExtractorService } from './expiry-extractor.service';
import { ExpiryCronService } from './expiry-cron.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [DocumentController],
  providers: [
    DocumentService, 
    GeminiService, 
    DriveService,
    ExpiryExtractorService,
    ExpiryCronService
  ],
})
export class DocumentationModule {}
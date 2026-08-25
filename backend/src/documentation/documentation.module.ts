import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { GeminiService } from './gemini.service';

@Module({
  controllers: [DocumentController],
  providers: [DocumentService, GeminiService],
})
export class DocumentationModule {}